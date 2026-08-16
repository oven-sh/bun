//! Single-flight credential resolution, shared by both clouds: per VM, one
//! chain runs per provider at a time, everyone who asks meanwhile waits on
//! it, the outcome lands in the provider's [`CredentialCache`], and a timer
//! refreshes it in the background before it expires.

use std::sync::Arc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue, JsResult};
use bun_s3_signing::ProviderError;

use super::cache::{CredentialCache, Expiring, MIN_REFRESH_INTERVAL, now_secs};
use super::io::{self, ChainFuture, Io};
use crate::timer::CallbackTimer;

pub type FlightResult<V> = Result<Arc<V>, Arc<ProviderError>>;

/// What to do with the value once it arrives (JS thread). Always called
/// exactly once, so whatever it owns (promises, request contexts) is released.
pub type Continuation<V> = Box<dyn FnOnce(FlightResult<V>) -> JsResult<()>>;

/// A cached source of one kind of credential (AWS credentials for a profile,
/// a Google token for a scope set …).
pub trait Provider: Sized + 'static {
    type Value: Expiring + 'static;

    fn cache(&self) -> &CredentialCache<Self::Value>;

    /// Snapshot whatever configuration the chain needs from `global` and
    /// return the chain, doing its I/O through `io`.
    fn begin(
        &self,
        global: &JSGlobalObject,
        io: Io,
    ) -> ChainFuture<Result<Self::Value, ProviderError>>;

    /// This VM's providers of this kind and their in-flight resolutions.
    fn flights() -> &'static mut Flights<Self>;

    /// The error for a resolution cut short by the VM going away.
    fn interrupted() -> ProviderError;
}

struct Entry<P: Provider> {
    provider: Arc<P>,
    /// `Some` while a chain is running: whom to tell when it lands.
    waiters: Option<Vec<Continuation<P::Value>>>,
    /// Held while a waiter that must be answered (a promise, a request) is
    /// registered, so the process stays up for it; background refreshes and
    /// synchronous probes do not hold it.
    keep_alive: bun_io::KeepAlive,
    refresh_timer: Option<Box<CallbackTimer>>,
}

impl<P: Provider> Entry<P> {
    fn idle(&self) -> bool {
        self.waiters.is_none() && self.refresh_timer.is_none()
    }
}

/// One VM's providers of kind `P`.
pub struct Flights<P: Provider> {
    entries: Vec<Entry<P>>,
}

impl<P: Provider> Default for Flights<P> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

/// Past this many providers, ones nothing references any more are dropped
/// on the next insert.
const EVICT_THRESHOLD: usize = 16;

impl<P: Provider> Flights<P> {
    pub fn find(&self, pred: impl Fn(&P) -> bool) -> Option<Arc<P>> {
        self.entries
            .iter()
            .find(|e| pred(&e.provider))
            .map(|e| Arc::clone(&e.provider))
    }

    pub fn insert(&mut self, provider: P) -> Arc<P> {
        if self.entries.len() >= EVICT_THRESHOLD {
            self.evict();
        }
        let provider = Arc::new(provider);
        self.entries.push(Entry {
            provider: Arc::clone(&provider),
            waiters: None,
            keep_alive: bun_io::KeepAlive::init(),
            refresh_timer: None,
        });
        provider
    }

    /// Drop providers no client, request or timer holds any more.
    fn evict(&mut self) {
        self.entries
            .retain(|e| !(e.idle() && Arc::strong_count(&e.provider) == 1));
    }

    /// The registered provider that `erased` (some type-erased handle to it)
    /// points at.
    pub fn by_address(&self, erased: *const ()) -> Option<Arc<P>> {
        self.entries
            .iter()
            .find(|e| Arc::as_ptr(&e.provider).cast::<()>() == erased)
            .map(|e| Arc::clone(&e.provider))
    }

    fn index(&self, provider: &Arc<P>) -> usize {
        self.entries
            .iter()
            .position(|e| Arc::ptr_eq(&e.provider, provider))
            .expect("providers come from Flights::insert")
    }
}

fn entry<P: Provider>(provider: &Arc<P>) -> &'static mut Entry<P> {
    let flights = P::flights();
    let i = flights.index(provider);
    &mut flights.entries[i]
}

fn run_waiters<V>(waiters: Vec<Continuation<V>>, result: &FlightResult<V>) -> JsResult<()> {
    // Every waiter runs even after one fails (a pending termination makes
    // the rest's promise settlements no-ops): each owns something it frees.
    let mut first_err = Ok(());
    for w in waiters {
        let r = w(result.clone());
        if first_err.is_ok() {
            first_err = r;
        }
    }
    first_err
}

/// Whether the registered waiters need the process to stay up for them.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Hold {
    /// A promise or request is waiting.
    Loop,
    /// Background refresh or a synchronous probe: exit need not wait.
    Nothing,
}

/// Register `waiters`; start the chain unless it is already running for
/// this provider in this VM.
fn start<P: Provider>(
    global: &JSGlobalObject,
    provider: &Arc<P>,
    waiters: Vec<Continuation<P::Value>>,
    hold: Hold,
) -> JsResult<()> {
    {
        let e = entry(provider);
        if hold == Hold::Loop {
            e.keep_alive.ref_(bun_io::js_vm_ctx());
        }
        if let Some(existing) = &mut e.waiters {
            existing.extend(waiters);
            return Ok(());
        }
        e.waiters = Some(waiters);
    }
    let io = Io::default();
    let chain = provider.begin(global, io.clone());
    let provider = Arc::clone(provider);
    io::drive(
        io.clone(),
        chain,
        Box::new(move |result| finish(&provider, &io, result)),
    )
}

fn finish<P: Provider>(
    provider: &Arc<P>,
    io: &Io,
    result: Result<P::Value, ProviderError>,
) -> JsResult<()> {
    let vm = VirtualMachine::get();
    let (waiters, held) = {
        let e = entry(provider);
        let held = e.keep_alive.is_active();
        e.keep_alive.unref(bun_io::js_vm_ctx());
        (e.waiters.take().unwrap_or_default(), held)
    };
    if io.interrupted() {
        // Aborted by a VM stop phase, not the chain's verdict: cache nothing,
        // and if anyone live is still waiting (test isolation), go again.
        if !waiters.is_empty() && vm.script_allowed() {
            let hold = if held { Hold::Loop } else { Hold::Nothing };
            return start(vm.global(), provider, waiters, hold);
        }
        return run_waiters(waiters, &Err(Arc::new(P::interrupted())));
    }
    let cache = provider.cache();
    let (previous_expiration, used_since_last) = cache.take_usage();
    let settled = cache.settle(result);
    // Keep the background refresh going while the value is in use; a
    // provider nobody read since the last refresh goes quiet until its next
    // use re-arms the timer (`keep_warm`). A refresh that brought nothing
    // newer (same expiration, or a failure with the old value still good) is
    // retried on a shortening schedule, but not into the last minute.
    let in_use = used_since_last || !waiters.is_empty();
    let rearm = in_use
        && settled.as_ref().is_ok_and(|v| {
            v.expiration() > previous_expiration
                || v.expiration()
                    .is_some_and(|e| e > now_secs() + MIN_REFRESH_INTERVAL)
        });
    if rearm {
        arm_refresh_timer(provider);
    } else {
        entry(provider).refresh_timer = None;
    }
    run_waiters(waiters, &settled)
}

fn arm_refresh_timer<P: Provider>(provider: &Arc<P>) {
    if !VirtualMachine::get().script_allowed() {
        return;
    }
    let cache = provider.cache();
    let Some(delay_ms) = cache.peek().and_then(|v| cache.refresh_delay_ms(&v)) else {
        return;
    };
    let address = Arc::as_ptr(provider).cast::<()>() as usize;
    entry(provider)
        .refresh_timer
        .get_or_insert_with(|| CallbackTimer::new(on_refresh_timer::<P>, address))
        .schedule(delay_ms);
}

fn on_refresh_timer<P: Provider>(address: usize) {
    let vm = VirtualMachine::get();
    let Some(provider) = P::flights().by_address(address as *const ()) else {
        return;
    };
    entry(&provider).refresh_timer = None;
    if vm.script_allowed() {
        refresh_ahead(vm.global(), &provider);
    }
}

/// Start a background refresh unless one is running or one just failed.
fn refresh_ahead<P: Provider>(global: &JSGlobalObject, provider: &Arc<P>) {
    if provider.cache().recent_error().is_none() {
        let _ = start(global, provider, Vec::new(), Hold::Nothing);
    }
}

/// For a caller about to use a cached value: refresh it in the background if
/// it is close to expiry, else make sure the refresh timer is armed.
pub fn keep_warm<P: Provider>(global: &JSGlobalObject, provider: &Arc<P>) {
    if provider.cache().fresh().is_none() {
        refresh_ahead(global, provider);
    } else if entry(provider).idle() {
        arm_refresh_timer(provider);
    }
}

/// Get a value with a comfortable lifetime left, without blocking: `then`
/// runs right away if a fresh one is cached (or a resolution failed moments
/// ago and a usable one is), otherwise once the (single, shared) resolution
/// or refresh completes. Always on `global`'s thread.
pub fn resolve_async<P: Provider>(
    global: &JSGlobalObject,
    provider: &Arc<P>,
    then: Continuation<P::Value>,
) -> JsResult<()> {
    let cache = provider.cache();
    if let Some(v) = cache.fresh() {
        keep_warm(global, provider);
        return then(Ok(v));
    }
    if let Some(e) = cache.recent_error() {
        return then(cache.usable().ok_or(e));
    }
    start(global, provider, vec![then], Hold::Loop)
}

/// What a synchronous caller can have right now.
pub enum Now<V> {
    Ready(FlightResult<V>),
    /// The chain needs I/O and is running in the background; `previous` is
    /// how the last attempt ended, if it failed.
    Pending {
        previous: Option<Arc<ProviderError>>,
    },
}

/// For synchronous callers: whatever can be had without waiting. A cached
/// value; else — since sources like environment variables and static
/// profile keys need no I/O — the result of a resolution that completes on
/// the spot. If the chain does need I/O it is left running in the background.
pub fn resolve_now_or_start<P: Provider>(
    global: &JSGlobalObject,
    provider: &Arc<P>,
) -> Now<P::Value> {
    let cache = provider.cache();
    if let Some(v) = cache.usable() {
        keep_warm(global, provider);
        return Now::Ready(Ok(v));
    }
    if let Some(e) = cache.recent_error() {
        return Now::Ready(Err(e));
    }
    let previous = cache.last_error();
    if entry(provider).waiters.is_some() {
        return Now::Pending { previous };
    }
    let slot: std::rc::Rc<core::cell::Cell<Option<FlightResult<P::Value>>>> = Default::default();
    let writer = std::rc::Rc::clone(&slot);
    let _ = start(
        global,
        provider,
        vec![Box::new(move |result| {
            writer.set(Some(result));
            Ok(())
        })],
        Hold::Nothing,
    );
    match slot.take() {
        Some(result) => Now::Ready(result),
        None => Now::Pending { previous },
    }
}

/// A promise for `build(value)` once `provider` has a value (now, if one is
/// cached), rejected with `to_error(..)` if it cannot be had. Neither runs if
/// the VM is shutting down by then; an exception `build` leaves pending
/// becomes the rejection.
pub fn promise<P: Provider>(
    global: &JSGlobalObject,
    provider: &Arc<P>,
    to_error: fn(&JSGlobalObject, &ProviderError) -> JSValue,
    build: impl FnOnce(&JSGlobalObject, &P::Value) -> JsResult<JSValue> + 'static,
) -> JsResult<JSValue> {
    let promise = JSPromiseStrong::init(global);
    let value = promise.value();
    let global_ref = GlobalRef::from(global);
    resolve_async(
        global,
        provider,
        Box::new(move |result| {
            let global: &JSGlobalObject = &global_ref;
            let mut promise = promise;
            if !global.bun_vm().script_allowed() {
                return Ok(());
            }
            match result {
                Ok(v) => {
                    let built = build(global, &v);
                    promise.settle(global, built)
                }
                Err(e) => promise.reject(global, Ok(to_error(global, &e))),
            }
        }),
    )?;
    Ok(value)
}
