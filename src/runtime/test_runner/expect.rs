use crate::test_runner::jest::FileColumns as _;
use core::cell::Cell;
use core::fmt;

use bun_core::Output;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsResult,
    ConsoleObject, JSFunction, JSPropertyIterator, JSString,
};
use bun_jsc::{JsClass as _, StringJsc as _};
use bun_core::ZigString;
use bun_jsc::js_promise;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_core::strings;

use super::bun_test::{self};
use super::diff_format::DiffFormatter;
use super::execution::ExpectAssertions;
use super::jest::Jest;
use super::expect::{JSValueTestExt, FormatterTestExt, make_formatter};

use bun_jsc::js_error_to_write_error;

// Matcher submodules are declared in `super::expect` (mod.rs); this file
// provides only the `Expect` payload + helpers they extend.




/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; the only
// field mutated post-construction (`flags`, via the `.not`/`.resolves`/`.rejects`
// chaining getters) is `Cell`-wrapped so the codegen shim can hand out a shared
// `&*m_ctx` borrow without aliasing UB. `parent` and `custom_label` are
// read-only after `call()` constructs the wrapper; `finalize()` owns `Box<Self>`
// so it may still tear them down by value.
#[bun_jsc::JsClass]
pub struct Expect {
    pub flags: Cell<Flags>,
    /// Rust-only (the C++-mirrored `Flags(u8)` byte is full). Non-null exactly while a
    /// deferred matcher's settle reaction re-invokes the same matcher; it points at the
    /// [`ReentryWindow`] stack local of [`Expect::on_subject_settled`], which saves the
    /// previous value and restores it (nested windows are a stack). Never dereferenced
    /// outside that synchronous window — see [`Expect::with_reentry_window`].
    pub reentry_window: Cell<*const ReentryWindow>,
    pub parent: Option<bun_test::RefDataPtr>,
    pub custom_label: bun_core::String,
}

/// Which await point inside a matcher invocation created a deferral. Recorded in the
/// reaction context and handed back through [`Expect::take_reentry_settlement`] so the
/// re-invoked matcher resumes past that point instead of re-running its producer.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DeferralOrigin {
    /// `.resolves`/`.rejects` subject promise (`get_value` / `apply_custom_matcher`).
    /// The re-invocation consumes the settlement; the raw subject's internal slots are
    /// never re-read (a subclass with a delegating `then` may never settle its own).
    /// A chained deferral carries the consumed settlement into every later re-invocation
    /// ([`ReentryWindow::consumed_subject`]) so that stays true past the first pass.
    Subject = 0,
    /// Promise returned by the function under `toThrow` (`get_value_as_to_throw`): the
    /// function already ran on the first pass and must not be called again.
    ThrownValue = 1,
    /// Promise returned by an async `expect.extend` matcher (`apply_custom_matcher`):
    /// the user matcher already ran on the first pass and must not be called again.
    MatcherResult = 2,
}

impl DeferralOrigin {
    /// Inverse of the `js_number_from_int32(origin as i32)` encoding used for the
    /// [`deferred_ctx::ORIGIN`] reaction-context slot.
    fn from_ctx_slot(value: JSValue) -> Self {
        match value.is_int32().then(|| value.as_int32()) {
            Some(1) => Self::ThrownValue,
            Some(2) => Self::MatcherResult,
            _ => Self::Subject,
        }
    }
}

/// State of one settle re-invocation of a deferred matcher. A STACK local of
/// [`Expect::on_subject_settled`], alive strictly for the synchronous `callee.call`;
/// `Expect::reentry_window` points at it for exactly that window (the previous pointer is
/// saved and restored, so a nested settle reaction gets its own window). All `JSValue`s
/// inside are rooted by the reaction frame + its context array for that whole window.
pub struct ReentryWindow {
    /// The `Expect` being re-invoked; only for the accessors' debug_assert.
    expect: *const Expect,
    /// How the deferral's subject settled; taken by the await point that deferred.
    settlement: Cell<Option<ReentrySettlement>>,
    /// The `.resolves`/`.rejects` subject settlement an earlier (or this) pass already
    /// consumed, carried across chained deferrals: every later re-invocation resumes the
    /// Subject await point from it instead of re-reading the raw subject's internal
    /// slots (which a subclass with a delegating `then` never settles). Recorded by
    /// [`Expect::take_reentry_settlement`] and forwarded by [`Expect::defer_matcher`].
    consumed_subject: Cell<Option<ReentrySettlement>>,
    /// User call site of the deferring invocation: this pass runs from a reaction job
    /// with no user frames for inline snapshots / a chained deferral to walk.
    call_site: ReentryCallSite,
    /// The re-invocation's own deferral; a re-invocation that defers AGAIN takes and
    /// reuses it instead of minting a second `D` — see [`ReentryDeferred`].
    deferred: Cell<Option<ReentryDeferred>>,
    /// The `Expect`'s flags at defer time ([`deferred_ctx::FLAGS`]), installed on the
    /// `Expect` for the window so later `.not`/`.resolves` mutations of the same handle
    /// cannot re-label an earlier deferral.
    flags: Flags,
}

/// The user call site captured when a matcher deferred ([`deferred_ctx::SRC_URL`]),
/// handed back to its settle re-invocation through [`ReentryWindow::call_site`].
/// `source_url` (a `JSString`) is rooted by the reaction's context array for the whole
/// re-invocation window, exactly like [`ReentrySettlement`]'s values.
#[derive(Clone, Copy)]
pub struct ReentryCallSite {
    pub source_url: JSValue,
    pub line: u32,
    pub column: u32,
}

/// `D` (the promise the FIRST pass returned to the user) + the call-site error, reused by
/// a chained deferral: the user only holds that `D`, so the awaited/un-awaited probe and
/// the settlement must target it, and only the first pass had user frames to attribute to.
#[derive(Clone, Copy)]
pub struct ReentryDeferred {
    pub deferred: JSValue,
    pub call_site_error: JSValue,
}

/// How the promise a matcher deferred on settled, handed from the settle reaction to the
/// re-invoked matcher (see [`ReentryWindow`] for the rooting invariant).
#[derive(Clone, Copy)]
pub struct ReentrySettlement {
    pub origin: DeferralOrigin,
    /// The promise the deferral's reactions were attached to.
    pub subject: JSValue,
    /// Its fulfillment value or rejection reason.
    pub value: JSValue,
    pub rejected: bool,
}


// Stored packed inside `Flags(u8)` bits 0..2, so `repr(u8)` here only
// governs the standalone discriminant size.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Promise {
    #[default]
    None = 0,
    Resolves = 1,
    Rejects = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum AsymmetricMatcherConstructorType {
    #[default]
    None = 0,
    Symbol = 1,
    String = 2,
    Object = 3,
    Array = 4,
    BigInt = 5,
    Boolean = 6,
    Number = 7,
    Promise = 8,
    InstanceOf = 9,
}

unsafe extern "C" {
    fn AsymmetricMatcherConstructorType__fromJS(
        global_object: *const JSGlobalObject,
        value: JSValue,
    ) -> i8;
}

impl AsymmetricMatcherConstructorType {
    pub(crate) fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        // C++ side opens `DECLARE_THROW_SCOPE` and returns -1 ⟺ threw; under
        // `BUN_JSC_validateExceptionChecks=1` its dtor sets `m_needExceptionCheck`, so
        // open a validation scope here and assert the sentinel/exception biconditional
        // (`AsymmetricMatcherConstructorType__fromJS` is `zero_is_throw`-shaped
        // with -1 as the sentinel).
        bun_jsc::validation_scope!(scope, global_object);
        // SAFETY: FFI call with valid &JSGlobalObject; JSValue is Copy/repr(transparent)
        let result = unsafe { AsymmetricMatcherConstructorType__fromJS(global_object, value) };
        scope.assert_exception_presence_matches(result == -1);
        Ok(match result {
            -1 => return Err(JsError::Thrown),
            1 => Self::Symbol,
            2 => Self::String,
            3 => Self::Object,
            4 => Self::Array,
            5 => Self::BigInt,
            6 => Self::Boolean,
            7 => Self::Number,
            8 => Self::Promise,
            9 => Self::InstanceOf,
            // C++ contract: any non-(-1) value is one of the above; treat
            // 0 (and any future unknown) as `None` rather than UB.
            _ => Self::None,
        })
    }
}

/// note: keep this struct in sync with C++ implementation (at bindings.cpp)
// Bit layout: promise (bits 0..2), not (bit 2), asymmetric_matcher_constructor_type (bits 3..8).
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags(pub u8);

pub(crate) type FlagsCppType = u8;
const _: () = assert!(core::mem::size_of::<Flags>() == core::mem::size_of::<FlagsCppType>());

impl Flags {
    const PROMISE_MASK: u8 = 0b0000_0011;
    const NOT_MASK: u8 = 0b0000_0100;
    const AMCT_SHIFT: u8 = 3;

    #[inline]
    pub fn promise(self) -> Promise {
        // The unused bit pattern 3 is representable in the packed bits but
        // is not a valid discriminant — transmuting it would be instant UB. `Flags` is fed from C++ via
        // `from_bitset`/`decode`, so the bits are not statically constrained.
        match self.0 & Self::PROMISE_MASK {
            1 => Promise::Resolves,
            2 => Promise::Rejects,
            // 0 and the unreachable-in-practice 3 both map to None.
            _ => Promise::None,
        }
    }
    #[inline]
    pub fn set_promise(&mut self, p: Promise) {
        self.0 = (self.0 & !Self::PROMISE_MASK) | (p as u8);
    }
    #[inline]
    pub fn not(self) -> bool {
        (self.0 & Self::NOT_MASK) != 0
    }
    #[inline]
    pub fn set_not(&mut self, v: bool) {
        self.0 = (self.0 & !Self::NOT_MASK) | ((v as u8) << 2);
    }
    #[inline]
    pub fn asymmetric_matcher_constructor_type(self) -> AsymmetricMatcherConstructorType {
        // Values 10..=31 are representable in the packed bits but are not
        // valid discriminants, and `Flags` arrives from C++ via `from_bitset`, so
        // a checked match is required (transmute would be UB).
        match self.0 >> Self::AMCT_SHIFT {
            0 => AsymmetricMatcherConstructorType::None,
            1 => AsymmetricMatcherConstructorType::Symbol,
            2 => AsymmetricMatcherConstructorType::String,
            3 => AsymmetricMatcherConstructorType::Object,
            4 => AsymmetricMatcherConstructorType::Array,
            5 => AsymmetricMatcherConstructorType::BigInt,
            6 => AsymmetricMatcherConstructorType::Boolean,
            7 => AsymmetricMatcherConstructorType::Number,
            8 => AsymmetricMatcherConstructorType::Promise,
            9 => AsymmetricMatcherConstructorType::InstanceOf,
            _ => AsymmetricMatcherConstructorType::None,
        }
    }
    #[inline]
    pub fn set_asymmetric_matcher_constructor_type(&mut self, t: AsymmetricMatcherConstructorType) {
        self.0 = (self.0 & 0b0000_0111) | ((t as u8) << Self::AMCT_SHIFT);
    }

    #[inline]
    pub fn encode(self) -> FlagsCppType {
        self.0
    }
    #[inline]
    pub fn decode(bitset: FlagsCppType) -> Self {
        Self(bitset)
    }
    #[inline]
    pub fn from_bitset(bitset: i32) -> Self {
        Self(bitset as u8)
    }
}

/// How [`Expect::get_value`] hands the received value back to a matcher.
///
/// The `T` parameter exists so scaffold helpers wrapping `get_value`
/// ([`Expect::matcher_prelude`], [`Expect::mock_prologue`]) can propagate a
/// deferral while returning their richer ready payload.
pub enum GetValueResult<T = JSValue> {
    /// The received value is available; run the matcher synchronously.
    Ready(T),
    /// `.resolves`/`.rejects` on a promise subject that must settle first:
    /// the matcher returns this promise to JS and is re-invoked on settlement.
    Deferred(JSValue),
}

/// Unwraps a [`GetValueResult`]: yields the `Ready` payload, or early-returns
/// `Ok(promise)` from the enclosing matcher on `Deferred`.
macro_rules! ready_or_defer {
    ($result:expr) => {
        match $result {
            $crate::test_runner::expect_core::GetValueResult::Ready(ready) => ready,
            $crate::test_runner::expect_core::GetValueResult::Deferred(promise) => {
                return Ok(promise);
            }
        }
    };
}
pub(crate) use ready_or_defer;

impl Expect {
    /// R-2 helper: read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    pub fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// Ordering invariant: every matcher entry point must call this BEFORE its
    /// `Deferred` early-return (`get_value`/`process_promise`), so the deferring first
    /// pass counts exactly once and the settle re-invocation is gated off below.
    pub fn increment_expect_call_counter(&self) {
        // A deferred matcher promise's settle reaction re-invokes the same matcher on the
        // same `Expect` inside a reentry window; the first invocation already counted it.
        if self.in_settle_reentry() {
            return;
        }
        let Some(parent) = self.parent.as_ref() else { return }; // not in bun:test
        let Some(buntest_strong) = parent.bun_test() else { return }; // the test file this expect() call was for is no longer
        let buntest = buntest_strong.get();
        if let Some(sequence) = parent.phase.sequence(buntest) {
            // found active sequence
            sequence.expect_call_count = sequence.expect_call_count.saturating_add(1);
        } else {
            // in concurrent group or otherwise failed to get the sequence; increment the expect call count in the reporter directly
            if let Some(reporter) = buntest.reporter {
                // SAFETY: `reporter` is `Option<NonNull<CommandLineReporter>>`,
                // owned by `test_command` for the process lifetime, never
                // aliased mutably elsewhere here.
                unsafe {
                    let s = (*reporter.as_ptr()).summary();
                    s.expectations = s.expectations.saturating_add(1);
                }
            }
        }
    }

    /// Run `f` against the active settle re-invocation window, or return `None` when the
    /// matcher is running as an ordinary (first-pass) invocation. The window is only
    /// handed out for the duration of `f` so a `&ReentryWindow` can never escape it.
    // SAFETY: the pointer is non-null only while `on_subject_settled`'s `callee.call` is
    // on the stack; the pointee is that frame's stack local, which strictly outlives the
    // synchronous window (the scopeguard restores the previous pointer before it dies).
    fn with_reentry_window<R>(&self, f: impl FnOnce(&ReentryWindow) -> R) -> Option<R> {
        let window = self.reentry_window.get();
        if window.is_null() {
            return None;
        }
        // SAFETY: see above — non-null implies the pointee is a live stack local.
        let window = unsafe { &*window };
        debug_assert!(core::ptr::eq(window.expect, self));
        Some(f(window))
    }

    /// This matcher invocation is the settle re-invocation of its own deferral, so it
    /// takes the synchronous path and skips the per-test bookkeeping the first pass did.
    pub fn in_settle_reentry(&self) -> bool {
        self.with_reentry_window(|_| ()).is_some()
    }

    /// Consume the settlement the settle reaction stashed for the deferral made at
    /// `origin`. Returns `None` outside a re-invocation, or when the pending settlement
    /// belongs to a different await point of the same matcher (e.g. the subject deferral
    /// of a `.resolves.toThrow()` chain), so each site only ever resumes its own deferral.
    ///
    /// The Subject settlement stays available past the pass that took it: a chained
    /// deferral's re-invocations resume the Subject await point from the carried copy
    /// ([`ReentryWindow::consumed_subject`]), never from the raw subject's internal slots.
    pub fn take_reentry_settlement(&self, origin: DeferralOrigin) -> Option<ReentrySettlement> {
        self.with_reentry_window(|window| {
            if let Some(settlement) = window.settlement.get()
                && settlement.origin == origin
            {
                window.settlement.set(None);
                if origin == DeferralOrigin::Subject {
                    window.consumed_subject.set(Some(settlement));
                }
                return Some(settlement);
            }
            if origin == DeferralOrigin::Subject {
                return window.consumed_subject.get();
            }
            None
        })
        .flatten()
    }

    /// The user call site captured when the matcher currently being re-invoked deferred
    /// ([`deferred_ctx::SRC_URL`]); `None` outside a settle re-invocation.
    fn reentry_call_site(&self) -> Option<ReentryCallSite> {
        self.with_reentry_window(|window| window.call_site)
    }

    /// The running settle re-invocation's own deferral, or `None` outside one (or when
    /// this re-invocation already deferred again); see [`ReentryDeferred`].
    fn take_reentry_deferred(&self) -> Option<ReentryDeferred> {
        self.with_reentry_window(|window| window.deferred.take()).flatten()
    }

    /// [`Expect::reentry_call_site`] as a [`CallerSrcLoc`](bun_jsc::call_frame::CallerSrcLoc).
    /// Like [`CallFrame::get_caller_src_loc`], the returned `str` is +1 and the caller
    /// owns releasing it.
    pub fn reentry_caller_src_loc(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<bun_jsc::call_frame::CallerSrcLoc>> {
        let Some(site) = self.reentry_call_site() else { return Ok(None) };
        Ok(Some(bun_jsc::call_frame::CallerSrcLoc {
            str: bun_core::String::from_js(site.source_url, global_this)?,
            line: site.line,
            column: site.column,
        }))
    }

    pub fn bun_test(&self) -> Option<bun_test::BunTestPtr> {
        let parent = self.parent.as_ref()?;
        parent.bun_test()
    }

    pub fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static str {
        // Rust has no compile-time string concat across runtime call sites (all ~188 callers pass literals, but the `not` bool is runtime
        // in some), so emulate via a process-lifetime intern table: each
        // unique (matcher, args, not) triple is rendered exactly once and the
        // boxed str is owned by the static `CACHE` for the rest of the
        // process. Returning
        // `&'static str` keeps the ~188 call sites and `throw()`'s `signature:
        // &'static str` parameter unchanged.
        use bun_collections::HashMap;
        use std::sync::OnceLock;
        type Key = (&'static str, &'static str, bool);
        static CACHE: OnceLock<bun_threading::Guarded<HashMap<Key, Box<str>>>> = OnceLock::new();
        let cache = CACHE.get_or_init(Default::default);

        let mut map = cache.lock();
        if let Some(s) = map.get(&(matcher_name, args, not)) {
            // SAFETY: `CACHE` is process-static and entries are never removed
            // or mutated, so the `Box<str>` allocation outlives the program.
            return unsafe { &*std::ptr::from_ref::<str>(s.as_ref()) };
        }
        const RECEIVED: &str = "<d>expect(<r><red>received<r><d>).<r>";
        let s: Box<str> = if not {
            format!("{RECEIVED}not<d>.<r>{matcher_name}<d>(<r>{args}<d>)<r>")
        } else {
            format!("{RECEIVED}{matcher_name}<d>(<r>{args}<d>)<r>")
        }
        .into_boxed_str();
        let ptr = std::ptr::from_ref::<str>(s.as_ref());
        map.insert((matcher_name, args, not), s);
        // SAFETY: just inserted into process-static `CACHE`; never removed.
        unsafe { &*ptr }
    }

    pub fn throw_pretty_matcher_error(
        global_this: &JSGlobalObject,
        custom_label: bun_core::String,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        flags: Flags,
        // Rust can't splice runtime args into a const format
        // string, so callers pre-render the message body (prose + args) into a
        // single `fmt::Arguments` here. `<tag>` markers in the rendered body
        // are still rewritten by `throw_pretty`'s post-render `pretty_fmt_rt`
        // pass, so the prose may contain `<r>`/`<red>`/etc.
        message: fmt::Arguments<'_>,
    ) -> JsError {
        let colors = Output::enable_ansi_colors_stderr();
        let chain: &'static str = match flags.promise() {
            Promise::Resolves => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("resolves<d>.<r>not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("resolves<d>.<r>not<d>.<r>", false)
                    }
                } else if colors {
                    bun_core::pretty_fmt!("resolves<d>.<r>", true)
                } else {
                    bun_core::pretty_fmt!("resolves<d>.<r>", false)
                }
            }
            Promise::Rejects => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("rejects<d>.<r>not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("rejects<d>.<r>not<d>.<r>", false)
                    }
                } else if colors {
                    bun_core::pretty_fmt!("rejects<d>.<r>", true)
                } else {
                    bun_core::pretty_fmt!("rejects<d>.<r>", false)
                }
            }
            Promise::None => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("not<d>.<r>", false)
                    }
                } else {
                    ""
                }
            }
        };
        // Matches the semantics of `Expect.throw`: empty label → default
        // signature header, non-empty label → user's label header.
        if custom_label.is_empty() {
            global_this.throw_pretty(format_args!(
                "<d>expect(<r><red>received<r><d>).<r>{chain}{matcher_name}<d>(<r>{matcher_params}<d>)<r>\n\n{message}",
            ))
        } else {
            global_this.throw_pretty(format_args!("{custom_label}\n\n{message}"))
        }
    }

    // `host_fn(getter)` shim passes `(&Self, &JSGlobalObject)` only,
    // but these getters also need `this_value` (returned to JS for chaining).
    // The shim is omitted (codegen owns the actual link name). R-2: mutation
    // of `flags` goes through `Cell` so the receiver is `&Self`.
    pub fn get_not(this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        this.update_flags(|f| f.set_not(!f.not()));
        this_value
    }

    // see `get_not` — `host_fn(getter)` shim signature mismatch.
    pub fn get_resolves(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        match this.flags.get().promise() {
            Promise::Resolves | Promise::None => this.update_flags(|f| f.set_promise(Promise::Resolves)),
            Promise::Rejects => {
                return Err(global_this.throw(format_args!("Cannot chain .resolves() after .rejects()")));
            }
        }
        Ok(this_value)
    }

    // see `get_not` — `host_fn(getter)` shim signature mismatch.
    pub fn get_rejects(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        match this.flags.get().promise() {
            Promise::None | Promise::Rejects => this.update_flags(|f| f.set_promise(Promise::Rejects)),
            Promise::Resolves => {
                return Err(global_this.throw(format_args!("Cannot chain .rejects() after .resolves()")));
            }
        }
        Ok(this_value)
    }

    /// Resolves the received value for a matcher call. Takes the matcher's
    /// `CallFrame` (not just `this`) so the deferral path can capture the
    /// callee + args + `this` needed to re-invoke the matcher once a
    /// `.resolves`/`.rejects` subject promise settles.
    pub fn get_value(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        // Every caller passes a string literal, so accept `&str`
        // (BStr::new below takes `AsRef<[u8]>`, so no copy).
        matcher_name: &str,
        matcher_params_fmt: &'static str,
    ) -> JsResult<GetValueResult> {
        let this_value = call_frame.this();
        let Some(value) = super::expect::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw2(
                "Internal error: the expect(value) was garbage collected but it should not have been!",
                (),
            ));
        };
        value.ensure_still_alive();

        // A `.resolves`/`.rejects` subject promise is never awaited synchronously from
        // inside the matcher (oven-sh/bun#33261) — defer even if it is already settled
        // (Jest parity: one-microtask minimum). The settle re-invocation (reentry window) and
        // non-promise subjects fall through to `process_promise`'s synchronous logic.
        if let Some(deferred) = self.try_defer_subject(global_this, call_frame, value) {
            return Ok(GetValueResult::Deferred(deferred?));
        }

        #[allow(clippy::disallowed_methods)] // template is a runtime parameter
        let matcher_params = Output::pretty_fmt_rt(matcher_params_fmt, Output::enable_ansi_colors_stderr());
        // The settle re-invocation of a `.resolves`/`.rejects` deferral resumes from the
        // settlement its reaction captured; the raw subject's internal slots are never
        // re-read (a subclass with a delegating `then` may never settle its own).
        if let Some(settlement) = self.take_reentry_settlement(DeferralOrigin::Subject) {
            return Self::process_settled_subject(
                self.custom_label.clone(),
                self.flags.get(),
                global_this,
                value,
                settlement.rejected,
                settlement.value,
                bstr::BStr::new(matcher_name),
                matcher_params,
                false,
            )
            .map(GetValueResult::Ready);
        }
        Self::process_promise(
            self.custom_label.clone(),
            self.flags.get(),
            global_this,
            value,
            bstr::BStr::new(matcher_name),
            matcher_params,
            false,
        )
        .map(GetValueResult::Ready)
    }

    /// Synchronous half of `.resolves`/`.rejects`: direction-check a settled subject and
    /// return its settled value (pretty matcher error on mismatch unless `silent`). Never
    /// waits: pending subjects were deferred before this (oven-sh/bun#33261); a caller
    /// with no matcher to re-invoke treats `Pending` as a mismatch.
    pub fn process_promise(
        custom_label: bun_core::String,
        flags: Flags,
        global_this: &JSGlobalObject,
        value: JSValue,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        silent: bool,
    ) -> JsResult<JSValue> {
        let resolution = flags.promise();
        if resolution == Promise::None {
            return Ok(value);
        }
        let Some(promise) = value.as_any_promise() else {
            if !silent {
                let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                return Err(Self::throw_pretty_matcher_error(
                    global_this,
                    custom_label,
                    matcher_name,
                    matcher_params,
                    flags,
                    format_args!(
                        "Expected promise<r>\nReceived: <red>{}<r>\n",
                        value.to_fmt(&mut formatter),
                    ),
                ));
            }
            return Err(JsError::Thrown);
        };

        let vm = global_this.vm();
        // Invariant: the subject is marked handled so an un-awaited rejecting subject is
        // never reported as an unhandled rejection.
        promise.set_handled(vm);

        let status = promise.status();
        if status == js_promise::Status::Pending {
            return Err(Self::promise_state_mismatch_error(
                custom_label,
                flags,
                global_this,
                value,
                matcher_name,
                matcher_params,
                silent,
                if resolution == Promise::Rejects { "rejects" } else { "resolves" },
                "is still pending",
            ));
        }
        Self::process_settled_subject(
            custom_label,
            flags,
            global_this,
            value,
            status == js_promise::Status::Rejected,
            promise.result(vm),
            matcher_name,
            matcher_params,
            silent,
        )
    }

    /// Settled half of [`Expect::process_promise`], taking the settlement explicitly:
    /// direction-check `(rejected, settled_value)` against `flags` and return the settled
    /// value. The `.resolves`/`.rejects` settle re-invocation resumes here from the
    /// settlement its reaction captured, never from the raw subject's internal slots.
    fn process_settled_subject(
        custom_label: bun_core::String,
        flags: Flags,
        global_this: &JSGlobalObject,
        subject: JSValue,
        rejected: bool,
        settled_value: JSValue,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        silent: bool,
    ) -> JsResult<JSValue> {
        let resolution = flags.promise();
        // `Some((expected, received))` describes a direction mismatch for the failure message.
        let mismatch: Option<(&str, &str)> = if rejected {
            (resolution == Promise::Resolves).then_some(("resolves", "rejected"))
        } else {
            (resolution == Promise::Rejects).then_some(("rejects", "resolved"))
        };
        if let Some((expected, received)) = mismatch {
            return Err(Self::promise_state_mismatch_error(
                custom_label,
                flags,
                global_this,
                subject,
                matcher_name,
                matcher_params,
                silent,
                expected,
                received,
            ));
        }
        settled_value.ensure_still_alive();
        Ok(settled_value)
    }

    /// The `.resolves`/`.rejects` state-mismatch failure ("expected a promise that
    /// {expected}, received one that {received}"), thrown pretty unless `silent`.
    fn promise_state_mismatch_error(
        custom_label: bun_core::String,
        flags: Flags,
        global_this: &JSGlobalObject,
        subject: JSValue,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        silent: bool,
        expected: &str,
        received: &str,
    ) -> JsError {
        if silent {
            return JsError::Thrown;
        }
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        Self::throw_pretty_matcher_error(
            global_this,
            custom_label,
            matcher_name,
            matcher_params,
            flags,
            format_args!(
                "Expected promise that {expected}<r>\nReceived promise that {received}: <red>{}<r>\n",
                subject.to_fmt(&mut formatter),
            ),
        )
    }

    pub fn is_asymmetric_matcher(value: JSValue) -> bool {
        if ExpectCustomAsymmetricMatcher::from_js(value).is_some() { return true; }
        if ExpectAny::from_js(value).is_some() { return true; }
        if ExpectAnything::from_js(value).is_some() { return true; }
        if ExpectStringMatching::from_js(value).is_some() { return true; }
        if ExpectCloseTo::from_js(value).is_some() { return true; }
        if ExpectObjectContaining::from_js(value).is_some() { return true; }
        if ExpectStringContaining::from_js(value).is_some() { return true; }
        if ExpectArrayContaining::from_js(value).is_some() { return true; }
        false
    }

    /// Called by C++ when matching with asymmetric matchers
    ///
    /// # Safety
    /// `out_flags`, `value`, and `any_constructor_type` must be valid, properly
    /// aligned pointers for the duration of the call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn Expect_readFlagsAndProcessPromise(
        instance_value: JSValue,
        global_this: &JSGlobalObject,
        out_flags: *mut FlagsCppType,
        value: *mut JSValue,
        any_constructor_type: *mut u8,
    ) -> bool {
        // SAFETY: `from_js` returns the live `m_ctx` payload owned by `instance_value`.
        let flags: Flags = 'flags: { unsafe {
            if let Some(instance) = ExpectCustomAsymmetricMatcher::from_js(instance_value) {
                break 'flags (*instance).flags;
            } else if let Some(instance) = ExpectAny::from_js(instance_value) {
                let f = (*instance).flags.get();
                // SAFETY: any_constructor_type is a valid out-ptr provided by C++ caller
                *any_constructor_type = f.asymmetric_matcher_constructor_type() as u8;
                break 'flags f;
            } else if let Some(instance) = ExpectAnything::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectStringMatching::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectCloseTo::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectObjectContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectStringContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectArrayContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else {
                break 'flags Flags::default();
            }
        } };

        // SAFETY: out_flags is a valid out-ptr provided by C++ caller
        unsafe { *out_flags = flags.encode() };

        // (note that matcher_name/matcher_args are not used because silent=true)
        // SAFETY: value is a valid in/out-ptr provided by C++ caller
        let v = unsafe { *value };
        // `expect.resolvesTo`/`expect.rejectsTo` run inside a synchronous deep-equality
        // walk that needs a boolean back, so a still-pending received promise cannot be
        // deferred the way a `.resolves` matcher is (there is no matcher invocation to
        // re-run once it settles). Keep the pre-existing blocking wait for this
        // asymmetric-only entry point (as `execute_custom_matcher` does for an async
        // asymmetric custom matcher); every matcher entry point defers instead.
        if flags.promise() != Promise::None {
            if let Some(promise) = v.as_any_promise() {
                // Handled BEFORE the wait, or the rejection is reported as unhandled while
                // the event loop runs it to settlement.
                promise.set_handled(global_this.vm());
                if promise.status() == js_promise::Status::Pending {
                    // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
                    global_this.bun_vm().as_mut().wait_for_promise(promise);
                }
            }
        }
        match Self::process_promise(bun_core::String::empty(), flags, global_this, v, "", "", true) {
            Ok(new) => {
                // SAFETY: value is a valid in/out-ptr provided by C++ caller
                unsafe { *value = new };
                true
            }
            Err(_) => false,
        }
    }

    pub fn get_snapshot_name(&self, hint: &[u8]) -> Result<Vec<u8>, bun_core::Error> {
        let parent = self.parent.as_ref().ok_or_else(|| bun_core::err!("NoTest"))?;
        let buntest_strong = parent.bun_test().ok_or_else(|| bun_core::err!("TestNotActive"))?;
        let buntest = buntest_strong.get();
        // A sequence parked on pending matcher promises has no `active_entry`, but it is
        // still the owning test: resolve it through the sequence's `test_entry`, exactly
        // like `record_provisional_matcher_failure`.
        let execution_entry: *const bun_test::ExecutionEntry = match parent.phase.entry(buntest) {
            Some(entry) => entry,
            None => match parent.phase.sequence(buntest).and_then(|s| s.test_entry) {
                Some(entry) => entry.as_ptr(),
                None => return Err(bun_core::err!("SnapshotInConcurrentGroup")),
            },
        };
        // SAFETY: arena-owned entry, alive for the lifetime of BunTest.
        let execution_entry = unsafe { &*execution_entry };

        let test_name: &[u8] = execution_entry.base.name.as_deref().unwrap_or(b"(unnamed)");

        let mut length: usize = 0;
        let mut curr_scope = execution_entry.base.parent;
        while let Some(scope) = curr_scope {
            // SAFETY: `parent` is a live `*mut DescribeScope` owned by the BunTest arena.
            let scope = unsafe { &*scope };
            if let Some(name) = scope.base.name.as_deref() {
                if !name.is_empty() {
                    length += name.len() + 1;
                }
            }
            curr_scope = scope.base.parent;
        }
        length += test_name.len();
        if !hint.is_empty() {
            length += hint.len() + 2;
        }

        let mut buf = vec![0u8; length];

        let mut index = buf.len();
        if !hint.is_empty() {
            index -= hint.len();
            buf[index..].copy_from_slice(hint);
            index -= test_name.len() + 2;
            buf[index..index + test_name.len()].copy_from_slice(test_name);
            buf[index + test_name.len()..index + test_name.len() + 2].copy_from_slice(b": ");
        } else {
            index -= test_name.len();
            buf[index..].copy_from_slice(test_name);
        }
        // copy describe scopes in reverse order
        curr_scope = execution_entry.base.parent;
        while let Some(scope) = curr_scope {
            // SAFETY: `parent` is a live `*mut DescribeScope` owned by the BunTest arena.
            let scope = unsafe { &*scope };
            if let Some(name) = scope.base.name.as_deref() {
                if !name.is_empty() {
                    index -= name.len() + 1;
                    buf[index..index + name.len()].copy_from_slice(name);
                    buf[index + name.len()] = b' ';
                }
            }
            curr_scope = scope.base.parent;
        }

        Ok(buf)
    }

    // Codegen's `host_fn_finalize` calls this via `|b| Expect::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(mut self: Box<Self>) {
        self.custom_label.deref();
        // RefDataPtr = RefPtr<RefData> has NO `Drop` impl (src/ptr/ref_count.rs)
        // so the Box drop below would leak the +1 — release explicitly.
        if let Some(parent) = self.parent.take() {
            parent.deref();
        }
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<2>();
        let arguments = arguments_.slice();
        let value = if arguments.len() < 1 { JSValue::UNDEFINED } else { arguments[0] };

        let mut custom_label = bun_core::String::empty();
        if arguments.len() > 1 {
            if arguments[1].is_string() || arguments[1].implements_to_string(global_this)? {
                let label = arguments[1].to_bun_string(global_this)?;
                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
                custom_label = label;
            }
        }

        let active_execution_entry_ref = if let Some(buntest_strong_) = bun_test::clone_active_strong() {
            let buntest_strong = buntest_strong_;
            let state = buntest_strong.get().get_current_state_data();
            Some(bun_test::BunTest::ref_(&buntest_strong, state))
        } else {
            None
        };
        // The ref
        // moves into `Expect` below and `to_js()` is infallible, so there is no
        // error path between ref creation and the wrapper taking ownership; from
        // then on `Expect::finalize` derefs `parent` (RefDataPtr has no Drop).

        let expect = Expect {
            flags: Cell::new(Flags::default()),
            reentry_window: Cell::new(core::ptr::null()),
            custom_label,
            parent: active_execution_entry_ref,
        };
        // `JsClass::to_js` boxes `self` and hands the pointer to `${T}__create`.
        let expect_js_value = expect.to_js(global_this);
        expect_js_value.ensure_still_alive();
        super::expect::js::captured_value_set_cached(expect_js_value, global_this, value);
        expect_js_value.ensure_still_alive();

        if let Some(expect_ptr) = Self::from_js(expect_js_value) {
            // SAFETY: `expect_ptr` is the live `m_ctx` payload of the just-created
            // wrapper, kept alive by `expect_js_value.ensure_still_alive()` above.
            unsafe { (*expect_ptr).post_match(global_this) };
        }
        Ok(expect_js_value)
    }

    /// Matcher failure path. The 75 `expect/to*.rs` matchers all call this as
    /// `return this.throw(global, SIGNATURE, format_args!(..))`, so the return
    /// type is `JsResult<JSValue>` (always `Err`) to slot directly into a
    /// host_fn body without `Err(..)` wrapping at every call site.
    pub fn throw(
        &self,
        global_this: &JSGlobalObject,
        signature: &'static str,
        args: fmt::Arguments<'_>,
    ) -> JsResult<JSValue> {
        // No compile-time string concat across runtime call sites, so
        // render at runtime.
        Err(if self.custom_label.is_empty() {
            global_this.throw_pretty(format_args!("{signature}{args}"))
        } else {
            global_this.throw_pretty(format_args!("{}{args}", self.custom_label))
        })
    }

    /// Legacy 4-arg form used by a handful of internal call sites in this file
    /// (snapshot/mock helpers) that take a separate `fmt` literal.
    /// Folds `fmt` into `args` and delegates.
    #[inline]
    pub fn throw_fmt(
        &self,
        global_this: &JSGlobalObject,
        signature: &'static str,
        _fmt: &'static str,
        args: fmt::Arguments<'_>,
    ) -> JsResult<JSValue> {
        // Rust cannot interpolate a runtime-literal format string, so every
        // caller bakes the rendered tail (literal text + substitutions) into
        // `args`; `_fmt` is kept only for documentation.
        // If `args` is empty but `_fmt` is not, a caller forgot to migrate.
        debug_assert!(
            _fmt.is_empty() || args.as_str() != Some(""),
            "throw_fmt: caller passed non-empty fmt tail {_fmt:?} but empty args — message body would be dropped",
        );
        self.throw(global_this, signature, args)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn constructor(global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Expect> {
        Err(global_this.throw(format_args!("expect() cannot be called with new")))
    }

    // pass here has a leading underscore to avoid name collision with the pass variable in other functions
    #[bun_jsc::host_fn(method)]
    pub fn _pass(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // The guard owns the `&Self` and calls
        // post_match on drop so it runs on every exit path.
        let this = scopeguard::guard(self, |t| t.post_match(global_this));

        let arguments_ = call_frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        let mut _msg: ZigString = ZigString::EMPTY;

        if !arguments.is_empty() {
            let value = arguments[0];
            value.ensure_still_alive();

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("pass", "message", "string"));
            }

            value.to_zig_string(&mut _msg, global_this)?;
        } else {
            _msg = ZigString::from_bytes(b"passes by .pass() assertion");
        }

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = true;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        let msg = _msg.to_slice();

        if not {
            let signature = Self::get_signature("pass", "", true);
            return this.throw_fmt(global_this, signature, "\n\n{s}\n", format_args!("\n\n{}\n", bstr::BStr::new(msg.slice())));
        }

        // should never reach here
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn fail(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // The guard owns the `&Self` borrow
        // so `post_match` runs on every exit.
        let this = scopeguard::guard(self, |t| t.post_match(global_this));

        let arguments_ = call_frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        let mut _msg: ZigString = ZigString::EMPTY;

        if !arguments.is_empty() {
            let value = arguments[0];
            value.ensure_still_alive();

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("fail", "message", "string"));
            }

            value.to_zig_string(&mut _msg, global_this)?;
        } else {
            _msg = ZigString::from_bytes(b"fails by .fail() assertion");
        }

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = false;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        let msg = _msg.to_slice();

        let signature = Self::get_signature("fail", "", true);
        this.throw_fmt(global_this, signature, "\n\n{s}\n", format_args!("\n\n{}\n", bstr::BStr::new(msg.slice())))
    }
}

pub struct TrimResult<'a> {
    pub trimmed: &'a [u8],
    pub start_indent: Option<&'a [u8]>,
    pub end_indent: Option<&'a [u8]>,
}

impl Expect {
    /// Resolves the received value of `toThrow`-family matchers: calls the received
    /// function and reports what it threw (or, for a promise it returned, what that
    /// promise rejected with).
    ///
    /// `Ready((thrown, returned))` when the function threw (or returned) synchronously.
    /// A returned promise is never observed in place — the matcher must not wait for it
    /// (oven-sh/bun#33261) and always evaluates to a promise (one-microtask minimum, like
    /// a `.resolves`/`.rejects` subject): it is `Deferred` on that promise, and the
    /// settle reaction re-invokes the matcher, which resumes here from the stashed
    /// settlement (the received function is never called a second time).
    pub fn get_value_as_to_throw(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        value: JSValue,
    ) -> JsResult<GetValueResult<(Option<JSValue>, JSValue)>> {
        // SAFETY: bun_vm() returns the live thread-local VirtualMachine; valid for this call.
        let vm = global_this.bun_vm().as_mut();

        let mut return_value_from_function: JSValue = JSValue::ZERO;

        if !value.js_type().is_function() {
            if self.flags.get().promise() != Promise::None {
                return Ok(GetValueResult::Ready((Some(value), return_value_from_function)));
            }
            return Err(global_this.throw(format_args!("Expected value must be a function")));
        }

        // Settle re-invocation of a deferred `toThrow`: the received function already ran
        // on the deferring pass; resume from how its returned promise settled.
        if let Some(settlement) = self.take_reentry_settlement(DeferralOrigin::ThrownValue) {
            return Ok(GetValueResult::Ready(if settlement.rejected {
                let reason = settlement.value;
                (Some(reason.to_error().unwrap_or(reason)), settlement.subject)
            } else {
                (None, settlement.subject)
            }));
        }

        let mut return_value: JSValue = JSValue::ZERO;

        // Drain existing unhandled rejections
        vm.global().handle_rejected_promises();

        let scope = vm.unhandled_rejection_scope();
        let prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
        vm.unhandled_pending_rejection_to_capture = Some(&raw mut return_value);
        vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        return_value_from_function = match value.call(global_this, JSValue::UNDEFINED, &[]) {
            Ok(v) => v,
            Err(err) => global_this.take_exception(err),
        };
        vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

        vm.global().handle_rejected_promises();

        if return_value.is_empty() {
            return_value = return_value_from_function;
        }

        if let Some(promise) = return_value.as_any_promise() {
            // Restored before the deferral early-return: the quiet capture handler
            // installed above must never leak past this matcher call.
            scope.apply(vm);
            promise.set_handled(global_this.vm());
            if self.can_track_matcher_promise() {
                // Park the matcher on the promise the function returned, even if it
                // already settled; only the settle re-invocation above reads its status.
                return Ok(GetValueResult::Deferred(self.defer_matcher(
                    global_this,
                    call_frame,
                    return_value,
                    DeferralOrigin::ThrownValue,
                )?));
            }
            // No owning test entry can keep this deferral alive (a concurrent group running
            // 2+ sequences, a hook-only beforeAll/afterAll sequence, outside bun:test):
            // keep the pre-existing synchronous wait so a failing assertion fails in place.
            // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
            global_this.bun_vm().as_mut().wait_for_promise(promise);
            let rejected = promise.status() == js_promise::Status::Rejected;
            let settled = promise.result(global_this.vm());
            return Ok(GetValueResult::Ready(if rejected {
                (Some(settled.to_error().unwrap_or(settled)), return_value_from_function)
            } else {
                (None, return_value_from_function)
            }));
        }

        if return_value != return_value_from_function {
            if let Some(existing) = return_value_from_function.as_any_promise() {
                existing.set_handled(global_this.vm());
            }
        }

        scope.apply(vm);

        Ok(GetValueResult::Ready((
            return_value.to_error().or_else(|| return_value_from_function.to_error()),
            return_value_from_function,
        )))
    }

    /// `Deferred` when [`Expect::get_value_as_to_throw`] deferred on the promise the
    /// received function returned; the settle re-invocation takes the `Ready` path.
    pub fn fn_to_err_string_or_undefined(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        value: JSValue,
    ) -> JsResult<GetValueResult<Option<JSValue>>> {
        // `ready_or_defer!` early-returns a bare `Ok(promise)`, which does not fit this
        // return type; propagate the deferral variant instead.
        let (err_value, _) = match self.get_value_as_to_throw(global_this, call_frame, value)? {
            GetValueResult::Ready(ready) => ready,
            GetValueResult::Deferred(promise) => return Ok(GetValueResult::Deferred(promise)),
        };

        let Some(mut err_value_res) = err_value else {
            return Ok(GetValueResult::Ready(None));
        };
        if err_value_res.is_any_error() {
            let message: JSValue = err_value_res
                .get_truthy(global_this, "message")?
                .unwrap_or(JSValue::UNDEFINED);
            err_value_res = message;
        } else {
            err_value_res = JSValue::UNDEFINED;
        }
        Ok(GetValueResult::Ready(Some(err_value_res)))
    }

    pub fn trim_leading_whitespace_for_inline_snapshot<'a>(
        str_in: &'a [u8],
        trimmed_buf: &'a mut [u8],
    ) -> TrimResult<'a> {
        debug_assert!(trimmed_buf.len() == str_in.len());
        // reshaped for borrowck — track dst as an index into trimmed_buf instead of a moving slice
        let mut src = str_in;
        let trimmed_buf_len = trimmed_buf.len();
        let mut dst_idx: usize = 0;
        let give_up_1 = TrimResult { trimmed: str_in, start_indent: None, end_indent: None };
        // if the line is all whitespace, trim fully
        // the first line containing a character determines the max trim count

        // read first line (should be all-whitespace)
        let Some(first_newline) = bun_core::index_of(src, b"\n") else { return give_up_1 };
        for &ch in &src[..first_newline] {
            if ch != b' ' && ch != b'\t' { return give_up_1; }
        }
        src = &src[first_newline + 1..];

        // read first real line and get indent
        let indent_len = src
            .iter()
            .position(|&ch| ch != b' ' && ch != b'\t')
            .unwrap_or(src.len());
        let indent_str = &src[..indent_len];
        macro_rules! give_up_2 {
            () => {
                TrimResult { trimmed: str_in, start_indent: Some(indent_str), end_indent: Some(indent_str) }
            };
        }
        if indent_len == 0 { return give_up_2!(); } // no indent to trim; save time
        // we're committed now
        trimmed_buf[dst_idx] = b'\n';
        dst_idx += 1;
        src = &src[indent_len..];
        let Some(nl) = bun_core::index_of(src, b"\n") else { return give_up_2!(); };
        let second_newline = nl + 1;
        trimmed_buf[dst_idx..dst_idx + second_newline].copy_from_slice(&src[..second_newline]);
        src = &src[second_newline..];
        dst_idx += second_newline;

        while !src.is_empty() {
            // try read indent
            let max_indent_len = src.len().min(indent_len);
            let line_indent_len = src[..max_indent_len]
                .iter()
                .position(|&ch| ch != b' ' && ch != b'\t')
                .unwrap_or(max_indent_len);
            src = &src[line_indent_len..];

            if line_indent_len < max_indent_len {
                if src.is_empty() {
                    // perfect; done
                    break;
                }
                if src[0] == b'\n' {
                    // this line has less indentation than the first line, but it's empty so that's okay.
                    trimmed_buf[dst_idx] = b'\n';
                    src = &src[1..];
                    dst_idx += 1;
                    continue;
                }
                // this line had less indentation than the first line, but wasn't empty. give up.
                return give_up_2!();
            } else {
                // this line has the same or more indentation than the first line. copy it.
                let line_newline = match bun_core::index_of(src, b"\n") {
                    Some(n) => n + 1,
                    None => {
                        // this is the last line. if it's not all whitespace, give up
                        for &ch in src {
                            if ch != b' ' && ch != b'\t' { return give_up_2!(); }
                        }
                        break;
                    }
                };
                trimmed_buf[dst_idx..dst_idx + line_newline].copy_from_slice(&src[..line_newline]);
                src = &src[line_newline..];
                dst_idx += line_newline;
            }
        }
        let Some(c) = str_in.iter().rposition(|&b| b == b'\n') else { return give_up_2!(); }; // there has to have been at least a single newline to get here
        let end_indent = c + 1;
        for &c in &str_in[end_indent..] {
            if c != b' ' && c != b'\t' { return give_up_2!(); } // we already checked, but the last line is not all whitespace again
        }

        // done
        TrimResult {
            trimmed: &trimmed_buf[..trimmed_buf_len - (trimmed_buf_len - dst_idx)],
            // equivalent to trimmed_buf[0 .. trimmed_buf.len - dst.len]; with index tracking dst.len == trimmed_buf_len - dst_idx
            start_indent: Some(indent_str),
            end_indent: Some(&str_in[end_indent..]),
        }
    }

    pub fn inline_snapshot(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        value: JSValue,
        property_matchers: Option<JSValue>,
        result: Option<&[u8]>,
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let this = self;
        // jest counts inline snapshots towards the snapshot counter for some reason
        let Some(runner) = Jest::runner() else {
            let signature = Self::get_signature(fn_name, "", false);
            return this.throw_fmt(global_this, signature, "", format_args!("\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n"));
        };
        match runner.snapshots.add_count(this, b"") {
            Ok(_) => {}
            Err(e) if e == bun_core::err!("OutOfMemory") => return Err(JsError::OutOfMemory),
            Err(e) if e == bun_core::err!("NoTest") => {}
            Err(e) if e == bun_core::err!("SnapshotInConcurrentGroup") => {}
            Err(e) if e == bun_core::err!("TestNotActive") => {}
            Err(_) => {}
        }

        let update = runner.snapshots.update_snapshots;
        let needs_write;

        let mut pretty_value: Vec<u8> = Vec::new();
        this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name)?;

        let mut start_indent: Option<Box<[u8]>> = None;
        let mut end_indent: Option<Box<[u8]>> = None;
        if let Some(saved_value) = result {
            let mut buf = vec![0u8; saved_value.len()];
            let trim_res = Self::trim_leading_whitespace_for_inline_snapshot(saved_value, &mut buf);

            if strings::eql_long(&pretty_value, trim_res.trimmed, true) {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            } else if update {
                runner.snapshots.passed += 1;
                needs_write = true;
                start_indent = trim_res.start_indent.map(Box::<[u8]>::from);
                end_indent = trim_res.end_indent.map(Box::<[u8]>::from);
            } else {
                runner.snapshots.failed += 1;
                let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
                let diff_format = DiffFormatter {
                    received_string: Some(&pretty_value),
                    expected_string: Some(trim_res.trimmed),
                    global_this: Some(global_this),
                    ..Default::default()
                };
                return Err(global_this.throw_pretty(format_args!("{signature}\n\n{diff_format}\n")));
            }
        } else {
            needs_write = true;
        }

        if needs_write {
            if crate::cli::ci_info::is_ci() {
                if !update {
                    let signature = Self::get_signature(fn_name, "", false);
                    // Only creating new snapshots can reach here (updating with mismatches errors earlier with diff)
                    return this.throw_fmt(
                        global_this,
                        signature,
                        "",
                        format_args!(
                            "\n\n<b>Matcher error<r>: Inline snapshot creation is disabled in CI environments unless --update-snapshots is used.\nTo override, set the environment variable CI=false.\n\nReceived: {}",
                            bstr::BStr::new(&pretty_value),
                        ),
                    );
                }
            }
            let Some(buntest_strong) = this.bun_test() else {
                let signature = Self::get_signature(fn_name, "", false);
                return this.throw_fmt(global_this, signature, "", format_args!("\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n"));
            };
            let buntest = buntest_strong.get();

            // 1. find the src loc of the snapshot. In the settle re-invocation of a
            // deferred matcher (`.resolves.toMatchInlineSnapshot()`) this frame is a
            // promise-reaction job with no user JS frames to walk, so use the call site
            // captured when the matcher deferred instead.
            let srcloc = match this.reentry_caller_src_loc(global_this)? {
                Some(srcloc) => srcloc,
                None => call_frame.get_caller_src_loc(global_this),
            };
            // bun_core::String is Copy
            // with no Drop, so wrap in the RAII guard to release the +1 on
            // every exit path (including the early returns below).
            let _srcloc_str_guard = bun_core::OwnedString::new(srcloc.str);
            let file_id = buntest.file_id;
            // MultiArrayList::get requires MultiArrayElement (derive pending);
            // use the column accessor which already compiles in jest.rs.
            let fget_source_path_text = runner.files.items_source()[file_id as usize].path.text;

            if !srcloc.str.eql_utf8(fget_source_path_text) {
                let signature = Self::get_signature(fn_name, "", false);
                return this.throw_fmt(
                    global_this,
                    signature,
                    "",
                    format_args!(
                        "\n\n<b>Matcher error<r>: Inline snapshot matchers must be called from the test file:\n  Expected to be called from file: <green>{:?}<r>\n  {} called from file: <red>{:?}<r>\n",
                        bstr::BStr::new(fget_source_path_text),
                        fn_name,
                        // `{:?}` on BStr renders a quoted, escaped string
                        bstr::BStr::new(srcloc.str.to_utf8().slice()),
                    ),
                );
            }

            // 2. save to write later
            runner.snapshots.add_inline_snapshot_to_write(file_id, super::snapshot::InlineSnapshotToWrite {
                line: core::ffi::c_ulong::from(srcloc.line),
                col: core::ffi::c_ulong::from(srcloc.column),
                value: core::mem::take(&mut pretty_value).into_boxed_slice(),
                has_matchers: property_matchers.is_some(),
                is_added: result.is_none(),
                kind: fn_name.as_bytes(),
                start_indent,
                end_indent,
            })?;
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn match_and_fmt_snapshot(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        pretty_value: &mut impl bun_io::Write,
        fn_name: &'static str,
    ) -> JsResult<()> {
        if let Some(_prop_matchers) = property_matchers {
            if !value.is_object() {
                let signature = Self::get_signature(fn_name, "<green>properties<r><d>, <r>hint", false);
                return self.throw_fmt(global_this, signature, "", format_args!("\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n")).map(drop);
            }

            let prop_matchers = _prop_matchers;

            if !value.jest_deep_match(prop_matchers, global_this, true)? {
                // TODO: print diff with properties from propertyMatchers
                let signature = Self::get_signature(fn_name, "<green>propertyMatchers<r>", false);
                let mut formatter = ConsoleObject::Formatter::new(global_this);
                return Err(global_this.throw_pretty(format_args!(
                    "{signature}\n\nExpected <green>propertyMatchers<r> to match properties from received object\n\nReceived: {}\n",
                    value.to_fmt(&mut formatter)
                )));
            }
        }

        if value.jest_snapshot_pretty_format(pretty_value, global_this).is_err() {
            let mut formatter = ConsoleObject::Formatter::new(global_this);
            return Err(global_this.throw(format_args!(
                "Failed to pretty format value: {}",
                value.to_fmt(&mut formatter),
            )));
        }
        Ok(())
    }

    pub fn snapshot(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        hint: &[u8],
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let this = self;
        let mut pretty_value: Vec<u8> = Vec::new();
        this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name)?;

        let runner = Jest::runner().expect("unreachable");
        let existing_value = match runner.snapshots.get_or_put(this, &pretty_value, hint) {
            Ok(v) => v,
            Err(err) => {
                let Some(buntest_strong) = this.bun_test() else {
                    return Err(global_this.throw(format_args!("Snapshot matchers cannot be used outside of a test")));
                };
                let buntest = buntest_strong.get();
                // MultiArrayList::get requires MultiArrayElement (derive pending); use column accessor.
                let test_file_path = runner.files.items_source()[buntest.file_id as usize].path.text;
                let test_file_path = bstr::BStr::new(test_file_path);
                return Err(match err {
                    e if e == bun_core::err!("FailedToOpenSnapshotFile") => {
                        global_this.throw(format_args!("Failed to open snapshot file for test file: {test_file_path}"))
                    }
                    e if e == bun_core::err!("FailedToMakeSnapshotDirectory") => {
                        global_this.throw(format_args!("Failed to make snapshot directory for test file: {test_file_path}"))
                    }
                    e if e == bun_core::err!("FailedToWriteSnapshotFile") => {
                        global_this.throw(format_args!("Failed write to snapshot file: {test_file_path}"))
                    }
                    e if e == bun_core::err!("SyntaxError") || e == bun_core::err!("ParseError") => {
                        global_this.throw(format_args!("Failed to parse snapshot file for: {test_file_path}"))
                    }
                    e if e == bun_core::err!("SnapshotCreationNotAllowedInCI") => {
                        let snapshot_name = runner.snapshots.last_error_snapshot_name.take();
                        if let Some(name) = snapshot_name {
                            global_this.throw(format_args!(
                                "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot name: \"{}\"\nReceived: {}",
                                bstr::BStr::new(&name),
                                bstr::BStr::new(&pretty_value),
                            ))
                        } else {
                            global_this.throw(format_args!(
                                "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nReceived: {}",
                                bstr::BStr::new(&pretty_value),
                            ))
                        }
                    }
                    e if e == bun_core::err!("SnapshotInConcurrentGroup") => {
                        global_this.throw(format_args!("Snapshot matchers are not supported in concurrent tests"))
                    }
                    e if e == bun_core::err!("TestNotActive") => {
                        global_this.throw(format_args!("Snapshot matchers are not supported after the test has finished executing"))
                    }
                    _ => {
                        let mut formatter = ConsoleObject::Formatter::new(global_this);
                        global_this.throw(format_args!("Failed to snapshot value: {}", value.to_fmt(&mut formatter)))
                    }
                });
            }
        };

        if let Some(saved_value) = existing_value {
            // clone to owned to release the &mut borrow on runner.snapshots
            // before mutating passed/failed counters below.
            let saved_value: Vec<u8> = saved_value.to_vec();
            if strings::eql_long(&pretty_value, &saved_value, true) {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            }

            runner.snapshots.failed += 1;
            let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
            let diff_format = DiffFormatter {
                received_string: Some(&pretty_value),
                expected_string: Some(&saved_value),
                global_this: Some(global_this),
                ..Default::default()
            };
            return Err(global_this.throw_pretty(format_args!("{signature}\n\n{diff_format}\n")));
        }

        Ok(JSValue::UNDEFINED)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub fn get_static_not(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_not(true);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub fn get_static_resolves_to(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Resolves);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub fn get_static_rejects_to(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Rejects);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn any(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAny::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn anything(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAnything::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn close_to(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectCloseTo::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn object_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectObjectContaining::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn string_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringContaining::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn string_matching(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringMatching::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn array_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectArrayContaining::call(global_this, call_frame)
    }

    /// Implements `expect.extend({ ... })`
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn extend(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args_ = call_frame.arguments_old::<1>();
        let args = args_.slice();

        if args.is_empty() || !args[0].is_object() {
            return Err(global_this.throw_pretty(format_args!(
                "<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n",
            )));
        }

        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_proto = unsafe { Expect__getPrototype(global_this) };
        let expect_constructor = <Self as bun_jsc::JsClass>::get_constructor(global_this);
        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_static_proto = unsafe { ExpectStatic__getPrototype(global_this) };

        // SAFETY: already checked that args[0] is an object
        let matchers_to_register = args[0].get_object().expect("unreachable");
        {
            let mut iter = JSPropertyIterator::init(
                global_this,
                matchers_to_register,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    own_properties_only: false,
                    observable: true,
                    only_non_index_properties: false,
                },
            )?;

            while let Some(matcher_name) = iter.next()? {
                let matcher_fn: JSValue = iter.value;

                if !matcher_fn.js_type().is_function() {
                    let type_name = if matcher_fn.is_null() {
                        bun_core::String::static_("null")
                    } else {
                        bun_core::String::init(matcher_fn.js_type_string(global_this).get_zig_string(global_this))
                    };
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "expect.extend: `{}` is not a valid matcher. Must be a function, is \"{}\"",
                        matcher_name, type_name,
                    )));
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                // `to_js_host_fn` returns an opaque closure, so emit an
                // explicit C-ABI shim and pass its address.
                bun_jsc::jsc_host_abi! {
                    unsafe fn __apply_custom_matcher_shim(
                        g: *mut bun_jsc::JSGlobalObject,
                        f: *mut bun_jsc::CallFrame,
                    ) -> JSValue {
                        // SAFETY: JSC guarantees both pointers are live for the call.
                        let (g, f) = unsafe { (&*g, &*f) };
                        bun_jsc::to_js_host_fn_result(g, Expect::apply_custom_matcher(g, f))
                    }
                }
                let host_fn_ptr: bun_jsc::JSHostFn = __apply_custom_matcher_shim;
                // SAFETY: FFI call with valid global, &bun_core::String, host-fn ptr, and JSValue.
                // C++ takes the function pointer **by value** (`NativeFunctionPtr`), not a
                // pointer-to-function-pointer — `JSHostFn` already is the
                // function-pointer type, so pass it directly.
                let wrapper_fn = unsafe {
                    Bun__JSWrappingFunction__create(
                        global_this,
                        &raw const matcher_name,
                        host_fn_ptr,
                        matcher_fn,
                        true,
                    )
                };

                expect_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_constructor.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_static_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
            }
        }

        // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
        global_this.bun_vm().as_mut().auto_garbage_collect();

        Ok(JSValue::UNDEFINED)
    }

    #[cold]
    fn throw_invalid_matcher_error(
        global_this: &JSGlobalObject,
        matcher_name: bun_core::String,
        result: JSValue,
    ) -> JsError {
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);

        // The template has no `<tag>` markers so the colors branch is a no-op anyway.
        let err = global_this.create_error_instance(format_args!(
            "Unexpected return from matcher function `{}`.\n\
             Matcher functions should return an object in the following format:\n  \
             {{message?: string | function, pass: boolean}}\n\
             '{}' was returned",
            matcher_name,
            result.to_fmt(&mut formatter),
        ));
        match bun_core::String::static_("InvalidMatcherError").to_js(global_this) {
            Ok(name) => err.put(global_this, b"name", name),
            // An exception (e.g. OOM) is already pending from to_js; propagate it
            // instead of throwing the partially-constructed error.
            Err(js_err) => return js_err,
        }
        global_this.throw_value(err)
    }

    /// Call a user-provided `expect.extend` matcher with a fresh
    /// [`ExpectMatcherContext`] receiver. The result may be a thenable.
    fn call_custom_matcher(
        global_this: &JSGlobalObject,
        matcher_fn: JSValue,
        args: &[JSValue],
        flags: Flags,
    ) -> JsResult<JSValue> {
        // JsClass::to_js takes `self` by value and boxes internally.
        let matcher_context_jsvalue = ExpectMatcherContext { flags }.to_js(global_this);
        matcher_context_jsvalue.ensure_still_alive();
        matcher_fn.call(global_this, matcher_context_jsvalue, args)
    }

    /// A custom matcher's promise rejected: report the reason, then throw.
    fn throw_custom_matcher_rejected(
        global_this: &JSGlobalObject,
        matcher_name: bun_core::String,
        reason: JSValue,
    ) -> JsError {
        // SAFETY: per-use reborrow of the thread-local VM (see VirtualMachine::get docs).
        VirtualMachine::get().as_mut().run_error_handler(reason, None);
        global_this.throw(format_args!(
            "Matcher `{}` returned a promise that rejected",
            matcher_name,
        ))
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to
    /// the matcher call) in ASYMMETRIC position (`expect(x).toEqual(expect.myMatcher())`).
    ///
    /// This runs inside a synchronous equality walk that needs a boolean back, so a
    /// still-pending async matcher result cannot be deferred the way the symmetric path
    /// (`apply_custom_matcher`) defers; it keeps the pre-existing blocking wait (see the
    /// comment at the wait site).
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub fn execute_custom_matcher(
        global_this: &JSGlobalObject,
        matcher_name: bun_core::String,
        matcher_fn: JSValue,
        args: &[JSValue],
        flags: Flags,
        silent: bool,
    ) -> JsResult<bool> {
        let mut result = Self::call_custom_matcher(global_this, matcher_fn, args, flags)?;
        // support for async matcher results
        if let Some(promise) = result.as_any_promise() {
            let vm = global_this.vm();
            promise.set_handled(vm);
            if promise.status() == js_promise::Status::Pending {
                // Deliberate, test-backed exception to "matchers never re-enter the event
                // loop" (oven-sh/bun#33261), mirroring the `expect.resolvesTo`/`rejectsTo`
                // subject wait in `Expect_readFlagsAndProcessPromise`: the pre-existing
                // blocking wait is kept because deferring is impossible here.
                // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
                global_this.bun_vm().as_mut().wait_for_promise(promise);
            }
            match promise.status() {
                js_promise::Status::Fulfilled => {
                    result = promise.result(vm);
                    result.ensure_still_alive();
                    debug_assert!(!result.is_empty());
                }
                js_promise::Status::Rejected => {
                    return Err(Self::throw_custom_matcher_rejected(
                        global_this,
                        matcher_name,
                        promise.result(vm),
                    ));
                }
                // `wait_for_promise` returns with the promise still pending only when the
                // VM forbade further execution (termination) mid-wait.
                js_promise::Status::Pending => {
                    return Err(global_this.throw(format_args!(
                        "Matcher `{}` returned a promise that has not resolved yet",
                        matcher_name,
                    )));
                }
            }
        }
        Self::process_custom_matcher_result(global_this, matcher_name, matcher_fn, result, flags, silent)
    }

    /// Validate and apply a custom matcher's (settled, non-promise) `result`, which must
    /// conform to `{ pass: boolean, message?: string | () => string }`.
    /// If silent=false, throws in JS when the result is not a pass (or is invalid).
    fn process_custom_matcher_result(
        global_this: &JSGlobalObject,
        matcher_name: bun_core::String,
        matcher_fn: JSValue,
        result: JSValue,
        flags: Flags,
        silent: bool,
    ) -> JsResult<bool> {
        let mut pass: bool = false;
        let mut message: JSValue = JSValue::UNDEFINED;

        // Parse and validate the custom matcher result, which should conform to: { pass: boolean, message?: () => string }
        let is_valid = 'valid: {
            if result.is_object() {
                if let Some(pass_value) = result.get(global_this, "pass")? {
                    pass = pass_value.to_boolean();

                    if let Some(message_value) = result.fast_get(global_this, bun_jsc::BuiltinName::Message)? {
                        if !message_value.is_string() && !message_value.is_callable() {
                            break 'valid false;
                        }
                        message = message_value;
                    }

                    break 'valid true;
                }
            }
            false
        };
        if !is_valid {
            return Err(Self::throw_invalid_matcher_error(global_this, matcher_name, result));
        }

        if flags.not() { pass = !pass; }
        if pass || silent { return Ok(pass); }

        // handle failure
        // bun_core::String is Copy with no Drop, so wrap in OwnedString to
        // release the +1 returned by to_bun_string/from_js on scope exit.
        let message_text: bun_core::OwnedString = if message.is_undefined() {
            bun_core::OwnedString::new(bun_core::String::static_("No message was specified for this matcher."))
        } else if message.is_string() {
            bun_core::OwnedString::new(message.to_bun_string(global_this)?)
        } else {
            if cfg!(debug_assertions) {
                debug_assert!(message.is_callable()); // checked above
            }

            // Pass the global object itself as `this`.
            let message_result = message.call_with_global_this(global_this, &[])?;
            bun_core::OwnedString::new(bun_core::String::from_js(message_result, global_this)?)
        };

        let matcher_params = CustomMatcherParamsFormatter {
            colors: Output::enable_ansi_colors_stderr(),
            global_this,
            matcher_fn,
        };
        Err(Self::throw_pretty_matcher_error(
            global_this,
            bun_core::String::empty(),
            matcher_name,
            matcher_params,
            Flags::default(),
            format_args!("{}", message_text.get()),
        ))
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn apply_custom_matcher(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        // retrieve the user-provided matcher function (matcher_fn)
        let func: JSValue = call_frame.callee();
        let matcher_fn: JSValue = get_custom_matcher_fn(func, global_this).unwrap_or(JSValue::UNDEFINED);
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw2(
                "Internal consistency error: failed to retrieve the matcher function for a custom matcher!",
                (),
            ));
        }
        matcher_fn.ensure_still_alive();

        // try to retrieve the Expect instance
        let this_value: JSValue = call_frame.this();
        let Some(expect_ptr) = Expect::from_js(this_value) else {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            return ExpectCustomAsymmetricMatcher::create(global_this, call_frame, matcher_fn);
        };
        // SAFETY: from_js returned a non-null live m_ctx pointer owned by the JS wrapper.
        // R-2: deref as shared (`&*`) — `process_promise` below may re-enter JS (await on a
        // thenable's user-defined `then`), which can call another matcher on this same
        // `expect()` chain; aliased `&Expect` is sound, aliased `&mut Expect` is not.
        let expect = unsafe { &*expect_ptr };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        let matcher_params = CustomMatcherParamsFormatter {
            colors: Output::enable_ansi_colors_stderr(),
            global_this,
            matcher_fn,
        };

        // retrieve the captured expected value
        let Some(mut value) = super::expect::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw(format_args!(
                "Internal consistency error: failed to retrieve the captured value"
            )));
        };
        // Counted before the deferral point, so the deferring first pass counts and the
        // settle re-invocation is the gated no-op.
        expect.increment_expect_call_counter();

        // A `.resolves`/`.rejects` subject promise defers the custom matcher exactly like
        // `get_value` defers the built-in matchers; the settle reaction re-invokes this
        // entry point inside a reentry window and consumes the captured settlement below.
        if let Some(deferred) = expect.try_defer_subject(global_this, call_frame, value) {
            return deferred;
        }

        // The settle re-invocation resumes from the settlement its reaction captured
        // (never from the raw subject's internal slots — see `get_value`).
        value = match expect.take_reentry_settlement(DeferralOrigin::Subject) {
            Some(settlement) => Self::process_settled_subject(
                expect.custom_label.clone(),
                expect.flags.get(),
                global_this,
                value,
                settlement.rejected,
                settlement.value,
                matcher_name,
                &matcher_params,
                false,
            )?,
            None => Self::process_promise(
                expect.custom_label.clone(),
                expect.flags.get(),
                global_this,
                value,
                matcher_name,
                &matcher_params,
                false,
            )?,
        };
        value.ensure_still_alive();

        // The settle re-invocation of a deferred async matcher resumes from the stashed
        // settlement: the user matcher already ran on the deferring pass and must not be
        // called a second time.
        let result: JSValue = match expect.take_reentry_settlement(DeferralOrigin::MatcherResult) {
            Some(settlement) if settlement.rejected => {
                return Err(Self::throw_custom_matcher_rejected(
                    global_this,
                    matcher_name,
                    settlement.value,
                ));
            }
            Some(settlement) => settlement.value,
            None => {
                // MarkedArgumentBuffer::new is scoped (closure-borrow); collect into a Vec
                // since the matcher call takes &[JSValue].
                let args = call_frame.arguments();
                let mut matcher_args: Vec<JSValue> = Vec::with_capacity(args.len() + 1);
                matcher_args.push(value);
                for arg in args {
                    matcher_args.push(*arg);
                }
                let result =
                    Self::call_custom_matcher(global_this, matcher_fn, &matcher_args, expect.flags.get())?;
                let Some(promise) = result.as_any_promise() else {
                    // Synchronous matcher result: apply it in place.
                    let _ = Self::process_custom_matcher_result(
                        global_this,
                        matcher_name,
                        matcher_fn,
                        result,
                        expect.flags.get(),
                        false,
                    )?;
                    return Ok(this_value);
                };
                promise.set_handled(global_this.vm());
                if expect.can_track_matcher_promise() {
                    // Async matcher: park this matcher call on the promise it returned and
                    // hand that deferred to the caller, even if it is already settled
                    // (one-microtask minimum, Jest parity). The deferring pass never runs
                    // from a settle reaction, so this cannot recurse.
                    return expect.defer_matcher(
                        global_this,
                        call_frame,
                        result,
                        DeferralOrigin::MatcherResult,
                    );
                }
                // No owning test entry can keep this deferral alive (a concurrent group
                // running 2+ sequences, a hook-only beforeAll/afterAll sequence, outside
                // bun:test): the pre-existing synchronous wait fails the matcher in place.
                // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
                global_this.bun_vm().as_mut().wait_for_promise(promise);
                match promise.status() {
                    js_promise::Status::Fulfilled => promise.result(global_this.vm()),
                    js_promise::Status::Rejected => {
                        return Err(Self::throw_custom_matcher_rejected(
                            global_this,
                            matcher_name,
                            promise.result(global_this.vm()),
                        ));
                    }
                    // `wait_for_promise` only returns on a pending promise when the VM
                    // forbade further execution (termination) mid-wait.
                    js_promise::Status::Pending => {
                        return Err(global_this.throw(format_args!(
                            "Matcher `{}` returned a promise that has not resolved yet",
                            matcher_name,
                        )));
                    }
                }
            }
        };
        let _ = Self::process_custom_matcher_result(
            global_this,
            matcher_name,
            matcher_fn,
            result,
            expect.flags.get(),
            false,
        )?;

        Ok(this_value)
    }

    // Rust has no associated const-fn aliases that satisfy
    // `Expect::add_snapshot_serializer(..)` UFCS, so forward.
    #[inline]
    pub fn add_snapshot_serializer(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::not_implemented_static_fn(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn has_assertions(global_this: &JSGlobalObject, _call_frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        let Some(buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw(format_args!("expect.assertions() must be called within a test")));
        };
        let buntest = buntest_strong.get();
        let state_data = buntest.get_current_state_data();
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw(format_args!("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed")));
        };
        if !matches!(execution.expect_assertions, ExpectAssertions::Exact(_)) {
            execution.expect_assertions = ExpectAssertions::AtLeastOne;
        }

        Ok(JSValue::UNDEFINED)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn assertions(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        let arguments_ = call_frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.is_empty() {
            return Err(global_this.throw_invalid_arguments(format_args!("expect.assertions() takes 1 argument")));
        }

        let expected: JSValue = arguments[0];

        if !expected.is_number() {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(format_args!(
                "Expected value must be a non-negative integer: {}",
                expected.to_fmt(&mut fmt),
            )));
        }

        let expected_assertions: f64 = expected.to_number(global_this)?;
        if expected_assertions.round() != expected_assertions
            || expected_assertions.is_infinite()
            || expected_assertions.is_nan()
            || expected_assertions < 0.0
            || expected_assertions > u32::MAX as f64
        {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(format_args!(
                "Expected value must be a non-negative integer: {}",
                expected.to_fmt(&mut fmt),
            )));
        }

        let unsigned_expected_assertions: u32 = expected_assertions as u32;

        let Some(buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw(format_args!("expect.assertions() must be called within a test")));
        };
        let buntest = buntest_strong.get();
        let state_data = buntest.get_current_state_data();
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw(format_args!("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed")));
        };
        execution.expect_assertions = ExpectAssertions::Exact(unsigned_expected_assertions);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn not_implemented_jsc_fn(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Err(global_this.throw(format_args!("Not implemented")))
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn not_implemented_static_fn(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Err(global_this.throw(format_args!("Not implemented")))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn not_implemented_jsc_prop(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Err(global_this.throw(format_args!("Not implemented")))
    }

    // `not_implemented_static_prop` is a static-prop getter
    // (`(globalThis, JSValue, JSValue)`, no `*Expect` receiver). The
    // `host_fn(getter)` shape was wrong (it injects `&Self`). Unreferenced by
    // codegen today, so kept as a plain assoc fn matching the static ABI.
    pub fn not_implemented_static_prop(global_this: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
        Err(global_this.throw(format_args!("Not implemented")))
    }

    /// Only triggers a GC sweep. It intentionally does NOT reset `flags`
    /// (not/resolves/rejects) or the cached captured value, so an `Expect` whose matcher
    /// deferred on a pending promise still carries both when the settle reaction
    /// re-invokes the same matcher (inside a [`ReentryWindow`]).
    pub fn post_match(&self, global_this: &JSGlobalObject) {
        global_this.bun_vm().auto_garbage_collect();
    }

    /// The returned guard holds the
    /// `&Expect` borrow, re-lends it via `Deref`, and calls `post_match` on drop so every
    /// exit path (success, `?`, explicit `return Err`) triggers the GC sweep.
    pub fn post_match_guard<'a>(&'a self, global: &'a JSGlobalObject) -> PostMatchGuard<'a> {
        PostMatchGuard { expect: self, global }
    }

    /// Shared front-matter for `expect(received).toX(...)` matchers.
    ///
    /// Composes the four lines every hand-ported matcher repeats — currently
    /// stamped out in **four** different shapes (scopeguard-rebind,
    /// scopeguard-side-binding, inner-closure-then-`post_match`, and *missing
    /// entirely* in `toContainAllValues` / `toBeArrayOfSize`). Third member of
    /// the matcher-scaffold family alongside [`Self::run_unary_predicate`] and
    /// [`Self::mock_prologue`], for matchers that need the received value but
    /// are NOT a pure unary predicate and NOT a mock-function matcher.
    ///
    /// Returns `Ready((guard, received_value, not))`, or `Deferred(promise)`
    /// when the subject promise must settle before the matcher can run
    /// (callers unwrap with `ready_or_defer!`). The guard derefs to `&Expect`
    /// and runs `post_match` on drop; `not` is `flags.not()` snapshotted once.
    /// Callers that don't need `not` until later destructure as `(this, v, _)`.
    #[inline]
    pub fn matcher_prelude<'a>(
        &'a self,
        global: &'a JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &str,
        matcher_params: &'static str,
    ) -> JsResult<GetValueResult<(PostMatchGuard<'a>, JSValue, bool)>> {
        let this = self.post_match_guard(global);
        let value = this.get_value(global, frame, matcher_name, matcher_params)?;
        // Counted before the deferral early-return: the re-invocation runs inside a
        // reentry window, so `increment_expect_call_counter` is a no-op there.
        this.increment_expect_call_counter();
        let value = match value {
            GetValueResult::Ready(value) => value,
            GetValueResult::Deferred(promise) => return Ok(GetValueResult::Deferred(promise)),
        };
        let not = this.flags.get().not();
        Ok(GetValueResult::Ready((this, value, not)))
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn do_unreachable(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arg = callframe.arguments_old::<1>().ptr[0];

        if arg.is_empty_or_undefined_or_null() {
            let error_value = bun_core::String::init("reached unreachable code").to_error_instance(global_this);
            error_value.put(global_this, b"name", bun_core::String::init("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        if arg.is_string() {
            let error_value = arg.to_bun_string(global_this)?.to_error_instance(global_this);
            error_value.put(global_this, b"name", bun_core::String::init("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        Err(global_this.throw_value(arg))
    }
}

/// RAII guard returned by [`Expect::post_match_guard`]. Holds an `&Expect` for the
/// duration of a matcher body and runs `post_match` on drop —
/// shared by every `expect().toX()` matcher.
/// R-2: shared borrow only (no `DerefMut`); all `Expect` methods reachable from a
/// matcher body take `&self`.
pub struct PostMatchGuard<'a> {
    expect: &'a Expect,
    global: &'a JSGlobalObject,
}

impl core::ops::Deref for PostMatchGuard<'_> {
    type Target = Expect;
    #[inline]
    fn deref(&self) -> &Expect {
        self.expect
    }
}

impl Drop for PostMatchGuard<'_> {
    fn drop(&mut self) {
        self.expect.post_match(self.global);
    }
}

pub struct CustomMatcherParamsFormatter<'a> {
    pub colors: bool,
    pub global_this: &'a JSGlobalObject,
    pub matcher_fn: JSValue,
}

impl fmt::Display for CustomMatcherParamsFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        // try to detect param names from matcher_fn (user function) source code
        if let Some(source_str) = JSFunction::get_source_code(self.matcher_fn) {
            let source_slice = source_str.to_utf8();

            let source: &[u8] = source_slice.slice();
            if let Some(lparen) = source.iter().position(|&b| b == b'(') {
                if let Some(rparen_rel) = source[lparen..].iter().position(|&b| b == b')') {
                    let rparen = lparen + rparen_rel;
                    let params_str = &source[lparen + 1..rparen];
                    let mut param_index: usize = 0;
                    for param_name in params_str.split(|&b| b == b',') {
                        if param_index > 0 {
                            // skip the first param from the matcher_fn, which is the received value
                            if param_index > 1 {
                                if self.colors {
                                    write!(writer, "{}", Output::pretty_fmt::<true>("<r><d>, <r><green>"))?;
                                } else {
                                    writer.write_str(", ")?;
                                }
                            } else if self.colors {
                                writer.write_str("<green>")?;
                            }
                            let param_name_trimmed = bun_core::trim(param_name, b" ");
                            if !param_name_trimmed.is_empty() {
                                write!(writer, "{}", bstr::BStr::new(param_name_trimmed))?;
                            } else {
                                write!(writer, "arg{}", param_index - 1)?;
                            }
                        }
                        param_index += 1;
                    }
                    if param_index > 1 && self.colors {
                        writer.write_str("<r>")?;
                    }
                    return Ok(()); // don't do fallback
                }
            }
        }

        // fallback
        bun_core::write_pretty!(writer, self.colors, "<green>...args<r>")
    }
}

/// Static instance of expect, holding a set of flags.
/// Returned for example when executing `expect.not`
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectStatic {
    pub flags: Flags,
}

impl ExpectStatic {
    pub fn create(global_this: &JSGlobalObject, flags: Flags) -> JsResult<JSValue> {
        let value = ExpectStatic { flags }.to_js(global_this);
        value.ensure_still_alive();
        Ok(value)
    }

    // codegen passes `(&mut *this, this_value, global)` for `this: true` getters
    // (jest.classes.ts); the `#[host_fn(getter)]` proc-macro emits a 2-arg shim, so we drop
    // it here and match the generated signature directly. `this_value` is unused.
    pub fn get_not(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        flags.set_not(!this.flags.not());
        Self::create(global_this, flags)
    }

    pub fn get_resolves_to(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(global_this, flags, b"resolvesTo"));
        }
        flags.set_promise(Promise::Resolves);
        Self::create(global_this, flags)
    }

    pub fn get_rejects_to(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(global_this, flags, b"rejectsTo"));
        }
        flags.set_promise(Promise::Rejects);
        Self::create(global_this, flags)
    }

    #[cold]
    fn async_chaining_error(global_this: &JSGlobalObject, flags: Flags, name: &[u8]) -> JsError {
        let str = match flags.promise() {
            Promise::Resolves => "resolvesTo",
            Promise::Rejects => "rejectsTo",
            _ => unreachable!(),
        };
        global_this.throw(format_args!(
            "expect.{}: already called expect.{} on this chain",
            bstr::BStr::new(name),
            str,
        ))
    }

    fn create_asymmetric_matcher_with_flags<T: AsymmetricMatcherClass + 'static>(
        this: &Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        let instance_jsvalue = T::invoke(global_this, call_frame)?;
        if !instance_jsvalue.is_empty() && !instance_jsvalue.is_any_error() {
            let Some(instance) = T::from_js_ptr(instance_jsvalue) else {
                return Err(global_this.throw_out_of_memory());
            };
            // SAFETY: from_js_ptr returns the live m_ctx payload owned by instance_jsvalue.
            unsafe { (*instance).flags_cell().set(this.flags) };
        }
        Ok(instance_jsvalue)
    }

    #[bun_jsc::host_fn(method)]
    pub fn anything(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAnything>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn any(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAny>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn array_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectArrayContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close_to(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectCloseTo>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn object_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectObjectContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn string_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn string_matching(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringMatching>(self, global_this, call_frame)
    }
}

// Trait used by `create_asymmetric_matcher_with_flags` to dispatch to the
// per-matcher inherent `call()` and post-hoc patch `flags`. The trait method is
// named `invoke` (not `call`) to avoid E0034 ambiguity with each matcher's
// inherent `fn call`.
pub(crate) trait AsymmetricMatcherClass {
    fn invoke(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue>;
    fn from_js_ptr(value: JSValue) -> Option<*mut Self>;
    /// R-2: each asymmetric-matcher payload exposes its `Cell<Flags>` so
    /// `ExpectStatic::create_asymmetric_matcher_with_flags` can patch it
    /// post-construction without forming `&mut Self`.
    fn flags_cell(&self) -> &Cell<Flags>;
}

macro_rules! impl_asymmetric_matcher_class {
    ($($t:ty),* $(,)?) => {
        $(
            impl AsymmetricMatcherClass for $t {
                #[inline]
                fn invoke(g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
                    <$t>::call(g, f)
                }
                #[inline]
                fn from_js_ptr(value: JSValue) -> Option<*mut Self> {
                    <$t as bun_jsc::JsClass>::from_js(value)
                }
                #[inline]
                fn flags_cell(&self) -> &Cell<Flags> {
                    &self.flags
                }
            }
        )*
    };
}
impl_asymmetric_matcher_class!(
    ExpectAnything,
    ExpectAny,
    ExpectArrayContaining,
    ExpectCloseTo,
    ExpectObjectContaining,
    ExpectStringContaining,
    ExpectStringMatching,
);

// ─── unary-predicate matcher scaffold ────────────────────────────────────
// Dedups the 22 hand-rolled `expect/toBe*.rs` files (~1270 LOC → ~300 LOC) and
// fixes two latent bugs (throw_fmt wrapper drop; post_match-before-throw
// ordering).
impl Expect {
    /// Shared scaffold for zero-arg `expect(v).toBeX()` matchers whose pass/fail
    /// is a pure infallible predicate on the received `JSValue` and whose failure
    /// message is the stock `"\n\nReceived: <red>{value}<r>\n"`.
    ///
    /// Replaces ~45 LOC of identical boilerplate per matcher: post_match guard,
    /// `get_value`, `increment_expect_call_counter`, `not`-xor, formatter,
    /// `get_signature`, `throw`.
    #[inline]
    pub fn run_unary_predicate(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        pred: impl FnOnce(JSValue) -> bool,
    ) -> JsResult<JSValue> {
        let (this, value, not) = ready_or_defer!(self.matcher_prelude(global, frame, matcher_name, "")?);
        if pred(value) != not {
            return Ok(JSValue::UNDEFINED);
        }
        let mut formatter = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "", not);
        this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value.to_fmt(&mut formatter)),
        )
    }

    /// Shared scaffold for one-arg `expect(v).toStartWith/toEndWith/toInclude(expected)`
    /// matchers: received and expected must both be strings, pass/fail is a pure
    /// `&[u8]`×`&[u8]` predicate (with empty `expected` always passing), and the
    /// failure message is the stock two-liner
    /// `"Expected to [not ]{verb}: <green>{expected}<r>\nReceived: <red>{value}<r>\n"`.
    ///
    /// Replaces ~100 LOC of byte-identical boilerplate per matcher: post_match
    /// guard, 1-arg check, expected-is-string check, `get_value`,
    /// `increment_expect_call_counter`, UTF-8 slice + predicate, `not`-xor, dual
    /// formatter, `get_signature`, `throw`.
    ///
    /// Normalizes an inherited inconsistency where `toInclude` passed `""`
    /// to `get_value`'s `matcher_params` while the other two passed
    /// `"<green>expected<r>"` — all three now use the latter (matches the
    /// signature already used in their failure messages).
    pub fn run_string_affix_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        verb: &'static str,
        pred: fn(&[u8], &[u8]) -> bool,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);

        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();
        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("{matcher_name}() requires 1 argument")));
        }
        let expected = arguments[0];
        expected.ensure_still_alive();
        if !expected.is_string() {
            return Err(global.throw(format_args!(
                "{matcher_name}() requires the first argument to be a string"
            )));
        }

        let value = this.get_value(global, frame, matcher_name, "<green>expected<r>")?;
        this.increment_expect_call_counter();
        let value = ready_or_defer!(value);

        let mut pass = value.is_string();
        if pass {
            let value_string = value.to_slice_or_null(global)?;
            let expected_string = expected.to_slice_or_null(global)?;
            pass = expected_string.slice().is_empty()
                || pred(value_string.slice(), expected_string.slice());
        }

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut f1 = make_formatter(global);
        let mut f2 = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "<green>expected<r>", not);
        if not {
            this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected to not {verb}: <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected.to_fmt(&mut f1),
                    value.to_fmt(&mut f2),
                ),
            )
        } else {
            this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected to {verb}: <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected.to_fmt(&mut f1),
                    value.to_fmt(&mut f2),
                ),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared skeleton for the 8 jest-extended `toContain{Key,Keys,AllKeys,AnyKeys,
// Value,Values,AllValues,AnyValues}` matchers. ~70% of each matcher body was the
// same boilerplate (post_match defer, arg-count check, expect-counter,
// get_value, `.not` flip, dual-formatter failure throw); only the pass-loop
// differs. Sibling to `run_unary_predicate` / `run_string_affix_matcher`.
// ──────────────────────────────────────────────────────────────────────────

/// Where `expected.is_array()` runs relative to `get_value` — observable when
/// both would throw (Keys-family validates *after*, Values-family *before*).
#[derive(Clone, Copy)]
pub enum ExpectedArray {
    /// `toContainKey` / `toContainValue`: scalar `expected`, no array check.
    None,
    /// `toContain*Values`: array check happens before `get_value`.
    BeforeValue,
    /// `toContain*Keys`: array check happens after `get_value`.
    AfterValue,
}

/// Failure-message verb pair for [`Expect::contain_matcher`]. The `not` arm
/// reads `"Expected to not {not_verb}: …"`, the plain arm `"Expected to
/// {verb}: …"`. For most matchers both are `"contain"`; the All/Any variants
/// override to `"contain all keys"` etc.
#[derive(Clone, Copy)]
pub struct ContainMsgs {
    pub verb: &'static str,
    pub not_verb: &'static str,
}
impl ContainMsgs {
    /// `"Expected to [not ]contain: …"` — toContainKey(s)/AnyKeys/Value(s).
    pub(crate) const CONTAIN: Self = Self { verb: "contain", not_verb: "contain" };
}

/// Result of a [`Expect::contain_matcher`] body closure: the pass/fail bit and
/// an optional override for the `Received:` value printed on failure
/// (`toContainAllKeys` prints `keys(value)` instead of `value`).
pub struct ContainOutcome {
    pub pass: bool,
    pub received_override: Option<JSValue>,
}
impl ContainOutcome {
    #[inline]
    pub(crate) fn pass(pass: bool) -> Self {
        Self { pass, received_override: None }
    }
}

impl Expect {
    /// Shared body for the eight `toContain{Key,Keys,AllKeys,AnyKeys,Value,
    /// Values,AllValues,AnyValues}` matchers. Handles the common envelope —
    /// `post_match` guard, 1-arg check, counter bump, `get_value`,
    /// optional `expected.is_array()` validation (positioned per
    /// [`ExpectedArray`]), `.not` flip, and the dual-formatter failure throw —
    /// and delegates only the per-matcher pass-loop to `body`.
    ///
    /// On pass, returns `frame.this()` (`thisValue`, not `undefined`).
    pub fn contain_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        expected_array: ExpectedArray,
        msgs: ContainMsgs,
        body: impl FnOnce(&JSGlobalObject, JSValue, JSValue) -> JsResult<ContainOutcome>,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);
        let this_value = frame.this();

        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();
        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("{matcher_name}() takes 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if matches!(expected_array, ExpectedArray::BeforeValue) && !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type(matcher_name, "expected", "array"));
        }
        expected.ensure_still_alive();

        let value = ready_or_defer!(this.get_value(global, frame, matcher_name, "<green>expected<r>")?);
        if matches!(expected_array, ExpectedArray::AfterValue) && !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type(matcher_name, "expected", "array"));
        }

        let not = this.flags.get().not();
        let outcome = body(global, value, expected)?;
        let mut pass = outcome.pass;
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        let received = outcome.received_override.unwrap_or(value);
        let mut f1 = make_formatter(global);
        let mut f2 = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "<green>expected<r>", not);
        if not {
            this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected to not {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                    msgs.not_verb,
                    expected.to_fmt(&mut f1),
                    received.to_fmt(&mut f2),
                ),
            )
        } else {
            this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected to {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                    msgs.verb,
                    expected.to_fmt(&mut f1),
                    received.to_fmt(&mut f2),
                ),
            )
        }
    }
}

// `unary_predicate_matcher!` is defined in `test_runner/mod.rs` (top-level,
// outside `cfg_jsc!`) so it can be addressed as `crate::unary_predicate_matcher!`
// from each `expect/toBe*.rs` file — `#[macro_export]` from inside a
// macro-expanded module is not addressable by absolute path
// (`macro_expanded_macro_exports_accessed_by_absolute_paths`).

// ─── matcher dispatch ──────────────────────────────────────────────────────
// The generate-classes.ts Rust emitter calls every prototype matcher as
// `Expect::to_*(&mut *this, global, callframe)`. Roughly half the
// `expect/to*.rs` files already attach via `impl Expect { .. }`; the rest are
// free `pub fn to_*(this: &mut Expect, ..)` functions (those sibling
// crate-modules can't open `impl Expect` without seeing the struct
// definition first). Those modules are mounted under the `super::expect`
// façade (mod.rs `matchers!`), so we add inherent forwarders here — the real
// bodies stay in their per-matcher files, this is the layering bridge.
macro_rules! __forward_matcher {
    ( $( $method:ident => $module:ident :: $func:ident ),* $(,)? ) => {
        impl Expect {
            $(
                #[inline]
                pub fn $method(
                    &self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    super::expect::$module::$func(self, global, frame)
                }
            )*
        }
    };
}
__forward_matcher! {
    to_be_array_of_size                      => to_be_array_of_size::to_be_array_of_size,
    to_be_empty                              => to_be_empty::to_be_empty,
    to_be_empty_object                       => to_be_empty_object::to_be_empty_object,
    to_be_instance_of                        => to_be_instance_of::to_be_instance_of,
    to_be_one_of                             => to_be_one_of::to_be_one_of,
    to_be_type_of                            => to_be_type_of::to_be_type_of,
    to_be_valid_date                         => to_be_valid_date::to_be_valid_date,
    to_contain_equal                         => to_contain_equal::to_contain_equal,
    to_end_with                              => to_end_with::to_end_with,
    to_equal_ignoring_whitespace             => to_equal_ignoring_whitespace::to_equal_ignoring_whitespace,
    to_have_been_called                      => to_have_been_called::to_have_been_called,
    to_have_been_called_once                 => to_have_been_called_once::to_have_been_called_once,
    to_have_been_called_times                => to_have_been_called_times::to_have_been_called_times,
    to_have_been_called_with                 => to_have_been_called_with::to_have_been_called_with,
    to_have_been_last_called_with            => to_have_been_last_called_with::to_have_been_last_called_with,
    to_have_been_nth_called_with             => to_have_been_nth_called_with::to_have_been_nth_called_with,
    to_have_last_returned_with               => to_have_last_returned_with::to_have_last_returned_with,
    to_have_length                           => to_have_length::to_have_length,
    to_have_nth_returned_with                => to_have_nth_returned_with::to_have_nth_returned_with,
    to_have_property                         => to_have_property::to_have_property,
    to_have_returned_with                    => to_have_returned_with::to_have_returned_with,
    to_include                               => to_include::to_include,
    to_match                                 => to_match::to_match,
    to_match_inline_snapshot                 => to_match_inline_snapshot::to_match_inline_snapshot,
    to_match_object                          => to_match_object::to_match_object,
    to_match_snapshot                        => to_match_snapshot::to_match_snapshot,
    to_satisfy                               => to_satisfy::to_satisfy,
    to_start_with                            => to_start_with::to_start_with,
    to_throw                                 => to_throw::to_throw,
    to_throw_error_matching_inline_snapshot  => to_throw_error_matching_inline_snapshot::to_throw_error_matching_inline_snapshot,
    to_throw_error_matching_snapshot         => to_throw_error_matching_snapshot::to_throw_error_matching_snapshot,
}

// Codegen'd `cache: true` accessors (`.classes.ts`) — Rust has no associated
// modules, so each lives as a sibling module instead of `Self::js::...`.
pub mod expect_string_matching_js {
    bun_jsc::codegen_cached_accessors!("ExpectStringMatching"; testValue);
}
pub mod expect_close_to_js {
    bun_jsc::codegen_cached_accessors!("ExpectCloseTo"; numberValue, digitsValue);
}
pub mod expect_object_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectObjectContaining"; objectValue);
}
pub mod expect_string_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectStringContaining"; stringValue);
}
pub mod expect_any_js {
    bun_jsc::codegen_cached_accessors!("ExpectAny"; constructorValue);
}
pub mod expect_array_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectArrayContaining"; arrayValue);
}
pub mod expect_custom_asymmetric_matcher_js {
    bun_jsc::codegen_cached_accessors!("ExpectCustomAsymmetricMatcher"; matcherFn, capturedArgs);
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectAnything {
    pub flags: Cell<Flags>,
}

impl ExpectAnything {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let anything_js_value = ExpectAnything { flags: Cell::new(Flags::default()) }.to_js(global_this);
        anything_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        Ok(anything_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectStringMatching {
    pub flags: Cell<Flags>,
}

impl ExpectStringMatching {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || (!args[0].is_string() && !args[0].is_reg_exp()) {
            const FMT: &str = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            return Err(global_this.throw_pretty(format_args!("{FMT}")));
        }

        let test_value = args[0];

        let string_matching_js_value = ExpectStringMatching { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_string_matching_js::test_value_set_cached(string_matching_js_value, global_this, test_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_matching_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectCloseTo {
    pub flags: Cell<Flags>,
}

impl ExpectCloseTo {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args_buf = call_frame.arguments_old::<2>();
        let args = args_buf.slice();

        if args.is_empty() || !args[0].is_number() {
            return Err(global_this.throw_pretty(format_args!(
                "<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value",
            )));
        }
        let number_value = args[0];

        let mut precision_value: JSValue = if args.len() > 1 { args[1] } else { JSValue::UNDEFINED };
        if precision_value.is_undefined() {
            precision_value = JSValue::js_number_from_int32(2); // default value from jest
        }
        if !precision_value.is_number() {
            return Err(global_this.throw_pretty(format_args!(
                "<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined",
            )));
        }

        let instance_jsvalue = ExpectCloseTo { flags: Cell::new(Flags::default()) }.to_js(global_this);
        number_value.ensure_still_alive();
        precision_value.ensure_still_alive();
        expect_close_to_js::number_value_set_cached(instance_jsvalue, global_this, number_value);
        expect_close_to_js::digits_value_set_cached(instance_jsvalue, global_this, precision_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectObjectContaining {
    pub flags: Cell<Flags>,
}

impl ExpectObjectContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args_buf = call_frame.arguments_old::<1>();
        let args = args_buf.slice();

        if args.is_empty() || !args[0].is_object() {
            const FMT: &str = "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n";
            return Err(global_this.throw_pretty(format_args!("{FMT}")));
        }

        let object_value = args[0];

        let instance_jsvalue = ExpectObjectContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_object_containing_js::object_value_set_cached(instance_jsvalue, global_this, object_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectStringContaining {
    pub flags: Cell<Flags>,
}

impl ExpectStringContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args_buf = call_frame.arguments_old::<1>();
        let args = args_buf.slice();

        if args.is_empty() || !args[0].is_string() {
            const FMT: &str = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            return Err(global_this.throw_pretty(format_args!("{FMT}")));
        }

        let string_value = args[0];

        let string_containing_js_value = ExpectStringContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_string_containing_js::string_value_set_cached(string_containing_js_value, global_this, string_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_containing_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectAny {
    pub flags: Cell<Flags>,
}

impl ExpectAny {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let _arguments = call_frame.arguments_old::<1>();
        let arguments: &[JSValue] = &_arguments.ptr[.._arguments.len];

        if arguments.is_empty() {
            return Err(global_this.throw2(
                "any() expects to be passed a constructor function. Please pass one or use anything() to match any object.",
                (),
            ));
        }

        let constructor = arguments[0];
        constructor.ensure_still_alive();
        if !constructor.is_constructor() {
            const FMT: &str = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            return Err(global_this.throw_pretty(format_args!("{FMT}")));
        }

        let asymmetric_matcher_constructor_type = AsymmetricMatcherConstructorType::from_js(global_this, constructor)?;

        // I don't think this case is possible, but just in case!
        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        let mut flags = Flags::default();
        flags.set_asymmetric_matcher_constructor_type(asymmetric_matcher_constructor_type);

        let any_js_value = ExpectAny { flags: Cell::new(flags) }.to_js(global_this);
        any_js_value.ensure_still_alive();
        expect_any_js::constructor_value_set_cached(any_js_value, global_this, constructor);
        any_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        Ok(any_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectArrayContaining {
    pub flags: Cell<Flags>,
}

impl ExpectArrayContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args_buf = call_frame.arguments_old::<1>();
        let args = args_buf.slice();

        if args.is_empty() || !args[0].js_type().is_array() {
            const FMT: &str = "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n";
            return Err(global_this.throw_pretty(format_args!("{FMT}")));
        }

        let array_value = args[0];

        let array_containing_js_value = ExpectArrayContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_array_containing_js::array_value_set_cached(array_containing_js_value, global_this, array_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(array_containing_js_value)
    }
}

/// An instantiated asymmetric custom matcher, returned from calls to `expect.toCustomMatch(...)`
///
/// Reference: `AsymmetricMatcher` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
/// (but only created for *custom* matchers, as built-ins have their own classes)
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. The only
// field, `flags`, is set once at construction (`create()`) and never written
// thereafter, so it stays a bare `Flags` (no `Cell` needed). Both host-fns
// call into user JS (`execute_impl` → `execute_custom_matcher`, `custom_print`
// → `matcher_fn.call`) which can re-enter on the same `m_ctx`; holding a
// `noalias` `&mut Self` across that call is Stacked-Borrows UB even with no
// field writes. The codegen shim emits `&*__this` for `&self` receivers.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectCustomAsymmetricMatcher {
    pub flags: Flags,
}

impl ExpectCustomAsymmetricMatcher {
    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub fn create(global_this: &JSGlobalObject, call_frame: &CallFrame, matcher_fn: JSValue) -> JsResult<JSValue> {
        // try to retrieve the ExpectStatic instance (to get the flags)
        let flags = if let Some(expect_static) = <ExpectStatic as bun_jsc::JsClass>::from_js(call_frame.this()) {
            // SAFETY: from_js returns the live m_ctx payload for this JSValue.
            unsafe { (*expect_static).flags }
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            Flags::default()
        };

        // create the matcher instance (flags stored upfront)
        let instance_jsvalue = ExpectCustomAsymmetricMatcher { flags }.to_js(global_this);
        instance_jsvalue.ensure_still_alive();

        // store the user-provided matcher function into the instance
        expect_custom_asymmetric_matcher_js::matcher_fn_set_cached(instance_jsvalue, global_this, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        let args = call_frame.arguments();
        let array = JSValue::create_array_from_slice(global_this, args)?;
        expect_custom_asymmetric_matcher_js::captured_args_set_cached(instance_jsvalue, global_this, array);
        array.ensure_still_alive();

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        Ok(instance_jsvalue)
    }

    fn execute_impl(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        received: JSValue,
    ) -> JsResult<bool> {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        let Some(matcher_fn) = expect_custom_asymmetric_matcher_js::matcher_fn_get_cached(this_value) else {
            return Err(global_this.throw2(
                "Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!",
                (),
            ));
        };
        matcher_fn.ensure_still_alive();
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw2(
                "Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!",
                (),
            ));
        }

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        let Some(captured_args) = expect_custom_asymmetric_matcher_js::captured_args_get_cached(this_value) else {
            return Err(global_this.throw(format_args!(
                "expect.{} misused, it needs to be instantiated by calling it with 0 or more arguments",
                matcher_name,
            )));
        };
        captured_args.ensure_still_alive();

        // prepare the args array as `[received, ...captured_args]`
        let args_count = captured_args.get_length(global_this)?;
        let mut matcher_args: Vec<JSValue> = Vec::with_capacity((args_count as usize).saturating_add(1));
        matcher_args.push(received);
        for i in 0..args_count {
            matcher_args.push(captured_args.get_index(global_this, i as u32)?);
        }

        Expect::execute_custom_matcher(global_this, matcher_name, matcher_fn, &matcher_args, this.flags, true)
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    ///
    /// # Safety
    /// `this` must point to a live `Self` and `global_this` must point to a live
    /// `JSGlobalObject` for the duration of the call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn ExpectCustomAsymmetricMatcher__execute(
        this: *mut Self,
        this_value: JSValue,
        global_this: *const JSGlobalObject,
        received: JSValue,
    ) -> bool {
        // SAFETY: called from C++ with valid pointers
        unsafe { Self::execute_impl(&*this, this_value, &*global_this, received) }.unwrap_or(false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn asymmetric_match(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let received_value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        let matched = Self::execute_impl(self, callframe.this(), global_this, received_value)?;
        Ok(JSValue::from(matched))
    }

    fn maybe_clear(global_this: &JSGlobalObject, err: JsError, dont_throw: bool) -> Result<bool, bun_core::Error> {
        if dont_throw {
            global_this.clear_exception();
            return Ok(false);
        }
        match err {
            JsError::OutOfMemory => Err(bun_core::Error::OUT_OF_MEMORY),
            _ => Err(bun_core::Error::UNEXPECTED),
        }
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub fn custom_print(
        &self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        writer: &mut (impl bun_io::Write + ?Sized),
        dont_throw: bool,
    ) -> Result<bool, bun_core::Error> {
        let Some(matcher_fn) = expect_custom_asymmetric_matcher_js::matcher_fn_get_cached(this_value) else { return Ok(false) };
        let fn_value = match matcher_fn.get(global_this, "toAsymmetricMatcher") {
            Ok(v) => v,
            Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
        };
        if let Some(fn_value) = fn_value {
            if fn_value.js_type().is_function() {
                let Some(captured_args) = expect_custom_asymmetric_matcher_js::captured_args_get_cached(this_value) else { return Ok(false) };
                let args_len = match captured_args.get_length(global_this) {
                    Ok(n) => n,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                let mut args: Vec<JSValue> = Vec::with_capacity(args_len as usize);
                let mut iter = match captured_args.array_iterator(global_this) {
                    Ok(it) => it,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                loop {
                    match iter.next() {
                        Ok(Some(arg)) => args.push(arg),
                        Ok(None) => break,
                        Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                    }
                }

                let result = match matcher_fn.call(global_this, this_value, &args) {
                    Ok(r) => r,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                let s = bun_core::OwnedString::new(match result.to_bun_string(global_this) {
                    Ok(s) => s,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                });
                write!(writer, "{}", s)?;
            }
        }
        Ok(false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_asymmetric_matcher(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let mut mutable_string = bun_core::MutableString::init_2048()?;

        // With `false`, JS exceptions surface
        // through `maybe_clear` as `Error::UNEXPECTED` while remaining set on
        // the VM; only allocation failures map to OOM. Propagate accordingly
        // instead of clobbering with a fresh OutOfMemory throw.
        let printed = self
            .custom_print(callframe.this(), global_this, mutable_string.writer(), false)
            .map_err(|e| {
                if e == bun_core::Error::OUT_OF_MEMORY {
                    global_this.throw_out_of_memory()
                } else {
                    // exception already on the VM (see `maybe_clear` with dont_throw=false)
                    JsError::Thrown
                }
            })?;
        if printed {
            let slice: &[u8] = mutable_string.slice();
            return bun_core::String::init(slice).to_js(global_this);
        }
        // Pretty-print the matcher instance itself, available
        // here as `callframe.this()`.
        ExpectMatcherUtils::print_value(global_this, callframe.this(), None)
    }
}

/// Reference: `MatcherContext` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectMatcherContext {
    pub flags: Flags,
}

impl ExpectMatcherContext {
    #[bun_jsc::host_fn(getter)]
    pub fn get_utils(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid &JSGlobalObject
        unsafe { ExpectMatcherUtils__getSingleton(global_this) }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_is_not(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.flags.not())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_promise(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match this.flags.promise() {
            Promise::Rejects => bun_core::String::static_("rejects").to_js(global_this),
            Promise::Resolves => bun_core::String::static_("resolves").to_js(global_this),
            _ => bun_core::String::empty().to_js(global_this),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_expand(_this: &Self, _global_this: &JSGlobalObject) -> JSValue {
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        JSValue::FALSE
    }

    #[bun_jsc::host_fn(method)]
    pub fn equals(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<3>();
        if arguments.len < 2 {
            return Err(global_this.throw2(
                "expect.extends matcher: this.util.equals expects at least 2 arguments",
                (),
            ));
        }
        let args = arguments.slice();
        Ok(JSValue::from(args[0].jest_deep_equals(args[1], global_this)?))
    }
}

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct ExpectMatcherUtils {}

impl ExpectMatcherUtils {
    #[unsafe(no_mangle)]
    pub extern "C" fn ExpectMatcherUtils_createSigleton(global_this: &JSGlobalObject) -> JSValue {
        ExpectMatcherUtils {}.to_js(global_this)
    }

    fn print_value(
        global_this: &JSGlobalObject,
        value: JSValue,
        color_or_null: Option<&'static str>,
    ) -> JsResult<JSValue> {
        use std::io::Write as _;
        let mut mutable_string = bun_core::MutableString::init_2048()?;

        // MutableString already writes to an in-memory Vec, so no extra
        // buffering layer is needed.
        let writer = mutable_string.writer();

        if let Some(color) = color_or_null {
            if Output::enable_ansi_colors_stderr() {
                // MutableString writes to a Vec; can't fail.
                let _ = writer.write_all(Output::pretty_fmt::<true>(color).as_ref());
            }
        }

        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        let _ = write!(writer, "{}", value.to_fmt(&mut formatter));

        if color_or_null.is_some() {
            if Output::enable_ansi_colors_stderr() {
                let _ = writer.write_all(Output::pretty_fmt::<true>("<r>").as_ref());
            }
        }

        // buffered_writer.flush() — no-op with direct Vec writer

        bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, mutable_string.slice())
    }

    #[inline]
    fn print_value_catched(
        global_this: &JSGlobalObject,
        value: JSValue,
        color_or_null: Option<&'static str>,
    ) -> JSValue {
        Self::print_value(global_this, value, color_or_null)
            .unwrap_or_else(|_| global_this.throw_out_of_memory_value())
    }

    #[bun_jsc::host_fn(method)]
    pub fn stringify(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        let arguments = arguments.slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, None))
    }

    #[bun_jsc::host_fn(method)]
    pub fn print_expected(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        let arguments = arguments.slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, Some("<green>")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn print_received(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        let arguments = arguments.slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, Some("<red>")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn matcher_hint(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<4>();
        let arguments = arguments.slice();

        if arguments.is_empty() || !arguments[0].is_string() {
            return Err(global_this.throw2(
                "matcherHint: the first argument (matcher name) must be a string",
                (),
            ));
        }
        // `to_bun_string` returns +1;
        // bun_core::String is `Copy` with no `Drop`, so wrap in `OwnedString`.
        let matcher_name = bun_core::OwnedString::new(arguments[0].to_bun_string(global_this)?);

        let received = if arguments.len() > 1 { arguments[1] } else { bun_core::String::static_("received").to_js(global_this)? };
        let expected = if arguments.len() > 2 { arguments[2] } else { bun_core::String::static_("expected").to_js(global_this)? };
        let options = if arguments.len() > 3 { arguments[3] } else { JSValue::UNDEFINED };

        let mut is_not = false;
        let mut comment: Option<&JSString> = None; // TODO support
        let mut promise: Option<&JSString> = None; // TODO support
        let mut second_argument: Option<&JSString> = None; // TODO support
        // TODO support "chalk" colors (they are actually functions like: (value: string) => string;)
        //var second_argument_color: ?string = null;
        //var expected_color: ?string = null;
        //var received_color: ?string = null;

        if !options.is_undefined_or_null() {
            if !options.is_object() {
                return Err(global_this.throw2(
                    "matcherHint: options must be an object (or undefined)",
                    (),
                ));
            }
            if let Some(val) = options.get(global_this, "isNot")? {
                is_not = val.to_boolean();
            }
            if let Some(val) = options.get(global_this, "comment")? {
                comment = Some(val.to_js_string(global_this)?);
            }
            if let Some(val) = options.get(global_this, "promise")? {
                promise = Some(val.to_js_string(global_this)?);
            }
            if let Some(val) = options.get(global_this, "secondArgument")? {
                second_argument = Some(val.to_js_string(global_this)?);
            }
        }
        let _ = (comment, promise, second_argument);

        let diff_formatter = DiffFormatter {
            received_string: None,
            expected_string: None,
            received: Some(received),
            expected: Some(expected),
            global_this: Some(global_this),
            not: is_not,
        };

        // Builds `getSignature("{f}", "<green>expected<r>", is_not) ++ "\n\n{f}\n"`
        // and substitutes `(matcher_name, diff_formatter)` into the two `{f}`
        // slots, then runs `Output.prettyFmt` over the *template* before
        // substitution. `pretty_fmt!` rewrites only the `<tag>` markers in
        // the static `RECEIVED`/`expected` literals — `matcher_name` and
        // `diff_formatter` are spliced in afterwards (matches `throw_pretty`'s
        // render-then-rewrite ordering, since Display output here contains no
        // `<tag>` literals).
        let colors = Output::enable_ansi_colors_stderr();
        let head: &'static str = if colors {
            bun_core::pretty_fmt!("<d>expect(<r><red>received<r><d>).<r>", true)
        } else {
            bun_core::pretty_fmt!("<d>expect(<r><red>received<r><d>).<r>", false)
        };
        let not: &'static str = if is_not {
            if colors {
                bun_core::pretty_fmt!("not<d>.<r>", true)
            } else {
                bun_core::pretty_fmt!("not<d>.<r>", false)
            }
        } else {
            ""
        };
        let expected_hint: &'static str = if colors {
            bun_core::pretty_fmt!("<d>(<r><green>expected<r><d>)<r>", true)
        } else {
            bun_core::pretty_fmt!("<d>(<r><green>expected<r><d>)<r>", false)
        };
        let buf = format!("{head}{not}{matcher_name}{expected_hint}\n\n{diff_formatter}\n");
        bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, buf.as_bytes())
    }
}

#[bun_jsc::JsClass]
pub struct ExpectTypeOf {}

impl ExpectTypeOf {
    pub fn create(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // `JsClass::to_js` takes `self` by value; the codegen-side boxes it.
        let value = ExpectTypeOf {}.to_js(global_this);
        value.ensure_still_alive();
        Ok(value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn fn_one_argument_returns_void(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_one_argument_returns_expect_type_of(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_returns_expect_type_of(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Self::create(global_this)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn constructor(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<*mut ExpectTypeOf> {
        Err(global_this.throw(format_args!("expectTypeOf() cannot be called with new")))
    }
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
}

pub mod mock {
    use super::*;
    use bun_jsc::ComptimeStringMapExt as _;

    // C++: `JSC::EncodedJSValue JSMockFunction__get{Calls,Returns}(
    //         JSC::JSGlobalObject*, EncodedJSValue)` — `[[ZIG_EXPORT(zero_is_throw)]]`.
    // The leading `globalThis` parameter is load-bearing: the body opens a
    // `DECLARE_THROW_SCOPE(globalThis->vm())`, so omitting it shifts `value`
    // into the pointer slot and dereferences a garbage `JSGlobalObject*`
    // (UBSan: null `VM&` bind in JSGlobalObject.h).
    unsafe extern "C" {
        #[link_name = "JSMockFunction__getCalls"]
        fn JSMockFunction__getCalls_raw(global: *mut JSGlobalObject, value: JSValue) -> JSValue;
        #[link_name = "JSMockFunction__getReturns"]
        fn JSMockFunction__getReturns_raw(global: *mut JSGlobalObject, value: JSValue) -> JSValue;
    }

    /// `bun.cpp.JSMockFunction__getCalls` — returns the `mock.calls` array for a
    /// JSMockFunction, or `undefined` if `value` is not a mock. Safe wrapper
    /// over the C++ shim so matchers don't carry their own `extern` blocks.
    /// `zero_is_throw`: a `.zero` return means the throw scope is set.
    #[allow(non_snake_case)]
    #[track_caller]
    #[inline]
    pub(crate) fn JSMockFunction__getCalls(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        // SAFETY: `global` is live; JSValue is repr(transparent) i64.
        bun_jsc::call_zero_is_throw(global, || unsafe {
            JSMockFunction__getCalls_raw(global.as_ptr(), value)
        })
    }

    /// `bun.cpp.JSMockFunction__getReturns` — see `JSMockFunction__getCalls`.
    #[allow(non_snake_case)]
    #[track_caller]
    #[inline]
    pub(crate) fn JSMockFunction__getReturns(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        // SAFETY: `global` is live; JSValue is repr(transparent) i64.
        bun_jsc::call_zero_is_throw(global, || unsafe {
            JSMockFunction__getReturns_raw(global.as_ptr(), value)
        })
    }

    /// Which mock-backed array a `toHave*` matcher inspects, plus which of the two
    /// "received is not a mock" error styles it emits. The three `*CalledWith`
    /// matchers use the Jest-style `Matcher error:` form routed through
    /// [`Expect::throw`]; everything else uses the bare `global.throw(...)` form.
    #[derive(Clone, Copy)]
    pub enum MockKind {
        /// `mock.calls`; not-a-mock → `global.throw("Expected value must be a mock function: …")`.
        /// toHaveBeenCalled / toHaveBeenCalledOnce / toHaveBeenCalledTimes.
        Calls,
        /// `mock.calls`; not-a-mock → `this.throw(signature, "Matcher error: received value must be a mock function …")`.
        /// toHaveBeenCalledWith / toHaveBeenLastCalledWith / toHaveBeenNthCalledWith.
        CallsWithSig,
        /// `mock.results`; not-a-mock → `global.throw("Expected value must be a mock function: …")`.
        /// toHaveReturned* / toHave*ReturnedWith.
        Returns,
    }

    impl Expect {
        /// Shared prologue for every `expect(mockFn).toHave*` matcher: arms the
        /// `post_match` guard, resolves the captured value (handling `.resolves`/
        /// `.rejects`), bumps the assertion counter, fetches the requested
        /// mock-backed array, and emits the kind-appropriate "not a mock" error.
        ///
        /// Returns `Ready` with the [`PostMatchGuard`] (so `post_match` runs when
        /// the caller drops it), the `mock.calls` / `mock.results` JSArray, and
        /// the raw received value (some matchers print it again on later error
        /// paths) — or `Deferred(promise)` when the subject must settle first
        /// (callers unwrap with `ready_or_defer!`).
        pub fn mock_prologue<'a>(
            &'a self,
            global: &'a JSGlobalObject,
            frame: &CallFrame,
            matcher_name: &'static str,
            matcher_params: &'static str,
            kind: MockKind,
        ) -> JsResult<GetValueResult<(PostMatchGuard<'a>, JSValue, JSValue)>> {
            let (this, value, _) = match self.matcher_prelude(global, frame, matcher_name, matcher_params)? {
                GetValueResult::Ready(ready) => ready,
                GetValueResult::Deferred(promise) => return Ok(GetValueResult::Deferred(promise)),
            };
            let arr = match kind {
                MockKind::Calls | MockKind::CallsWithSig => JSMockFunction__getCalls(global, value)?,
                MockKind::Returns => JSMockFunction__getReturns(global, value)?,
            };
            if !arr.js_type().is_array() {
                let mut formatter = make_formatter(global);
                return Err(match kind {
                    MockKind::CallsWithSig => this
                        .throw(
                            global,
                            Self::get_signature(matcher_name, matcher_params, false),
                            format_args!(
                                "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                                value.to_fmt(&mut formatter),
                            ),
                        )
                        .unwrap_err(),
                    MockKind::Calls | MockKind::Returns => global.throw(format_args!(
                        "Expected value must be a mock function: {}",
                        value.to_fmt(&mut formatter),
                    )),
                });
            }
            Ok(GetValueResult::Ready((this, arr, value)))
        }
    }

    pub(crate) fn jest_mock_return_object_type(global_this: &JSGlobalObject, value: JSValue) -> JsResult<ReturnStatus> {
        if let Some(type_string) = value.fast_get(global_this, bun_jsc::BuiltinName::Type)? {
            if type_string.is_string() {
                if let Some(val) = RETURN_STATUS_MAP.from_js(global_this, type_string)? {
                    return Ok(val);
                }
            }
        }
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        Err(global_this.throw(format_args!(
            "Expected value must be a mock function with returns: {}",
            value.to_fmt(&mut formatter),
        )))
    }

    pub(crate) fn jest_mock_return_object_value(global_this: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        Ok(value.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED))
    }

    // split lifetimes — `&'a mut Formatter<'a>` is the invariant-borrow trap
    // (forces the &mut to live as long as the Formatter's own param, which outlives the
    // local). `'g` tracks the JSGlobalObject borrow inside Formatter; `'a` is the short
    // &mut borrow held by this struct.
    pub(crate) struct AllCallsWithArgsFormatter<'a, 'g> {
        pub global_this: &'g JSGlobalObject,
        pub calls: JSValue,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'a mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for AllCallsWithArgsFormatter<'_, '_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let calls_count = u32::try_from(
                self.calls
                    .get_length(self.global_this)
                    .map_err(js_error_to_write_error)?,
            )
            .unwrap();
            if calls_count == 0 {
                writer.write_str("(no calls)")?;
                return Ok(());
            }

            for i in 0..calls_count {
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                write!(writer, "           {:>4}: ", i + 1)?;
                let call_args = self
                    .calls
                    .get_index(self.global_this, i)
                    .map_err(js_error_to_write_error)?;
                write!(writer, "{}", call_args.to_fmt(&mut **formatter))?;
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    pub(crate) enum ReturnStatus {
        #[strum(serialize = "throw")]
        Throw,
        #[strum(serialize = "return")]
        Return,
        #[strum(serialize = "incomplete")]
        Incomplete,
    }

    bun_core::comptime_string_map! {
        /// JS string extraction + lookup is provided by `ComptimeStringMapExt::from_js`
        /// (see `jest_mock_return_object_type`).
        pub(crate) static RETURN_STATUS_MAP: ReturnStatus = {
            b"throw" => ReturnStatus::Throw,
            b"return" => ReturnStatus::Return,
            b"incomplete" => ReturnStatus::Incomplete,
        };
    }

    // Formatter for when there are multiple returns or errors
    // split lifetimes — `&'f mut Formatter<'g>` instead of `&'a mut Formatter<'a>`.
    // The single-lifetime form makes the mut-borrow invariant in `'a` and forces the borrow to
    // last for the Formatter's whole lifetime, tripping dropck (E0597) at the call site.
    pub(crate) struct AllCallsFormatter<'g, 'f> {
        pub global_this: &'g JSGlobalObject,
        pub returns: JSValue,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'f mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for AllCallsFormatter<'_, '_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let mut num_returns: i32 = 0;
            let mut num_calls: i32 = 0;

            let mut iter = self
                .returns
                .array_iterator(self.global_this)
                .map_err(js_error_to_write_error)?;
            loop {
                let next = iter.next().map_err(js_error_to_write_error)?;
                let Some(item) = next else { break };
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                num_calls += 1;
                write!(writer, "           {:>2}: ", num_calls)?;

                let value = jest_mock_return_object_value(self.global_this, item)
                    .map_err(js_error_to_write_error)?;
                match jest_mock_return_object_type(self.global_this, item)
                    .map_err(js_error_to_write_error)?
                {
                    ReturnStatus::Return => {
                        write!(writer, "{}", value.to_fmt(&mut **formatter))?;
                        num_returns += 1;
                    }
                    ReturnStatus::Throw => {
                        write!(writer, "function call threw an error: {}", value.to_fmt(&mut **formatter))?;
                    }
                    ReturnStatus::Incomplete => {
                        write!(writer, "<incomplete call>")?;
                    }
                }
            }
            let _ = num_returns;
            Ok(())
        }
    }

    // split lifetimes — see AllCallsFormatter above for rationale (avoids the
    // `&'a mut T<'a>` invariance trap that locks the Formatter borrow for its entire life).
    pub struct SuccessfulReturnsFormatter<'g, 'f> {
        pub global_this: &'g JSGlobalObject,
        pub successful_returns: &'f Vec<JSValue>,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'f mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for SuccessfulReturnsFormatter<'_, '_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let len = self.successful_returns.len();
            if len == 0 { return Ok(()); }

            let mut printed_once = false;

            for (idx, val) in self.successful_returns.iter().enumerate() {
                let i = idx + 1;
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                write!(writer, "           {:>4}: ", i)?;
                write!(writer, "{}", val.to_fmt(&mut **formatter))?;
            }
            Ok(())
        }
    }
}

// ───────────────────── deferred matcher promise settlement ──────────────────────
// Async matchers must not re-enter the event loop from inside the matcher
// (oven-sh/bun#33261): the matcher returns a deferred promise `D`, and native reactions
// on the subject re-invoke it (inside a [`ReentryWindow`]) once the subject settles.

/// Indices into the GC-rooted reaction context array built by [`Expect::defer_subject`]
/// and unpacked by [`Expect::on_subject_settled`]. The array is the reaction's context
/// argument, so JSC roots every captured value until the subject settles.
mod deferred_ctx {
    /// The `Expect` wrapper (`expect(value)…`), i.e. the matcher's `this`.
    pub(super) const EXPECT_THIS: u32 = 0;
    /// The matcher function itself (`call_frame.callee()`), re-invoked on settlement.
    pub(super) const CALLEE: u32 = 1;
    /// `JSArray` of the original matcher arguments.
    pub(super) const ARGS: u32 = 2;
    /// The deferred promise `D` the matcher returned to user code.
    pub(super) const DEFERRED: u32 = 3;
    /// Error created at defer time: its stack points at the user's `expect()` call and is
    /// used to attribute an un-awaited failing matcher to that line.
    pub(super) const CALL_SITE_ERROR: u32 = 4;
    /// [`super::DeferralOrigin`] discriminant (an int32) identifying which await point of
    /// the matcher deferred, handed back to the re-invocation through the
    /// [`super::ReentryWindow`]'s settlement.
    pub(super) const ORIGIN: u32 = 5;
    /// The promise the reactions were attached to. A call-produced deferral
    /// (`ThrownValue` / `MatcherResult`) resumes from it instead of re-running its
    /// producer.
    pub(super) const SUBJECT: u32 = 6;
    /// The owning sequence's [`matcher_epoch`](super::execution::ExecutionSequence::matcher_epoch)
    /// at registration time (an int32), or `undefined` when no sequence was resolvable.
    /// `settle_matcher_promise` ignores a settlement whose epoch no longer matches
    /// (abandoned by the per-test timeout, or reset away by a retry/repeat attempt).
    pub(super) const EPOCH: u32 = 7;
    /// User call site of the deferring matcher invocation (`SRC_URL` is a `JSString`;
    /// line/column are int32s), carried into the re-invocation's
    /// [`super::ReentryWindow::call_site`].
    pub(super) const SRC_URL: u32 = 8;
    pub(super) const SRC_LINE: u32 = 9;
    pub(super) const SRC_COL: u32 = 10;
    /// int32 [`super::Flags`] byte of the `Expect` at defer time. The re-invocation runs
    /// with these flags restored: `.not`/`.resolves` mutate the shared wrapper, so a
    /// later chained getter must not relabel an earlier call's deferral.
    pub(super) const FLAGS: u32 = 11;
    /// The already-consumed `.resolves`/`.rejects` subject settlement a chained deferral
    /// carries forward ([`super::ReentryWindow::consumed_subject`]), so every later
    /// re-invocation resumes the Subject await point from it instead of re-reading the
    /// raw subject's internal slots. `CARRIED_SUBJECT_REJECTED` is an int32 boolean, or
    /// `undefined` when the deferral has no subject settlement to carry (a first-pass
    /// deferral); the other two slots are only read when it is present.
    pub(super) const CARRIED_SUBJECT_REJECTED: u32 = 12;
    pub(super) const CARRIED_SUBJECT_VALUE: u32 = 13;
    pub(super) const CARRIED_SUBJECT: u32 = 14;
    pub(super) const LEN: usize = 15;
}

impl Expect {
    /// Shared gate for the matcher entry points that observe the `.resolves`/`.rejects`
    /// subject (`get_value`, `apply_custom_matcher`): when promise flags are set, this is
    /// the first pass (no reentry window), and the subject is a `JSPromise` cell, mark the
    /// subject handled, defer the matcher, and return the deferred promise it must hand
    /// back to JS. `None` means the caller proceeds with the synchronous
    /// `process_promise` logic.
    ///
    /// The `JSPromise` requirement is the deferral machinery's own invariant: the settle
    /// re-invocation and the rooted `deferred_ctx::SUBJECT` slot need a stable `JSPromise`
    /// cell to mark handled and to resume the matcher from once it settles. A bare
    /// thenable (a non-promise object with a `then`) has no such cell, so it is
    /// deliberately not deferred: it keeps the pre-existing synchronous path, where
    /// `process_promise` rejects non-promise subjects. That is a scope cut, not a `then2`
    /// limitation — the settle reactions attach to a tracking promise this code creates,
    /// never to the subject itself.
    fn try_defer_subject(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        value: JSValue,
    ) -> Option<JsResult<JSValue>> {
        if self.flags.get().promise() == Promise::None
            || self.in_settle_reentry()
            || value.as_promise().is_none()
        {
            return None;
        }
        if let Some(promise) = value.as_any_promise() {
            // An un-awaited rejecting subject must not report as an unhandled rejection.
            promise.set_handled(global_this.vm());
            if !self.can_track_matcher_promise() {
                // No owning test entry can keep this deferral alive (a concurrent group
                // running 2+ sequences, a hook-only beforeAll/afterAll sequence, outside
                // bun:test): synchronously wait and fall through to the settled logic.
                if promise.status() == js_promise::Status::Pending {
                    // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
                    global_this.bun_vm().as_mut().wait_for_promise(promise);
                }
                return None;
            }
        }
        Some(self.defer_subject(global_this, call_frame, value))
    }

    /// Defer a matcher whose `.resolves`/`.rejects` subject promise has not been observed
    /// yet. See [`Expect::defer_matcher`].
    pub fn defer_subject(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        subject: JSValue,
    ) -> JsResult<JSValue> {
        // The settle re-invocation must never defer its (now settled) subject again (the
        // reentry window gates `process_promise`), or the counter would never reach zero.
        debug_assert!(!self.in_settle_reentry());
        self.defer_matcher(global_this, call_frame, subject, DeferralOrigin::Subject)
    }

    /// Defer the calling matcher until `subject` settles: create the deferred `D` the
    /// matcher returns to JS, capture a GC-rooted reaction context (see [`deferred_ctx`]),
    /// register the pending deferral on the owning test's sequence, and attach the native
    /// settle reactions to a tracking promise that adopts `subject`.
    ///
    /// `subject` must already be `set_handled` (an un-awaited rejecting subject must not
    /// report as an unhandled rejection) and must be a `JSPromise` cell: the settle
    /// re-invocation and the rooted `deferred_ctx::SUBJECT` slot both key on that cell.
    /// Bare thenables are deliberately never deferred (see [`Expect::try_defer_subject`]).
    pub fn defer_matcher(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        subject: JSValue,
        origin: DeferralOrigin,
    ) -> JsResult<JSValue> {
        debug_assert!(subject.as_promise().is_some());

        // Count the deferral on the owning sequence FIRST and release it again if anything
        // below throws; once the reactions are attached (infallible) they own the release.
        let epoch = self.register_pending_matcher_promise();
        let registration =
            scopeguard::guard((), |()| self.settle_pending_matcher_promise(global_this, epoch));

        // A deferral made from inside a settle re-invocation (the chained half of
        // `.resolves.toThrow(...)` / `.resolves` + async custom matcher) reuses the
        // deferred `D` and the call-site error the first pass already created instead of
        // minting new ones (see [`ReentryDeferred`]): only that pass ran with the user's
        // `expect()` call on the stack, and `D` is the promise the user holds.
        let chained = self.take_reentry_deferred();
        let deferred_js = match &chained {
            Some(outer) => outer.deferred,
            None => js_promise::JSPromise::create(global_this).to_js(),
        };
        // A fresh one is created NOW so its stack points at the user's `expect()` call,
        // not at the promise-reaction job that later re-invokes the matcher.
        let call_site_error = match &chained {
            Some(outer) => outer.call_site_error,
            None => {
                // Only its stack matters: it donates the user's `expect()` frames to the
                // real failure (`attributed_matcher_error`) and to the stale-epoch reason.
                global_this
                    .create_error_instance(format_args!("expect() call site for a deferred matcher"))
            }
        };
        // The user call site, captured for the same reason. A deferral made from inside a
        // settle re-invocation (e.g. the `toThrow` half of `.resolves.toThrow(...)`)
        // inherits the site captured by the deferral driving it: this frame is a
        // promise-reaction job with no user frames to walk.
        let call_site = match self.reentry_call_site() {
            Some(site) => site,
            None => {
                let srcloc = call_frame.get_caller_src_loc(global_this);
                // `str` is +1; the JSString made from it is an independent GC-owned copy.
                let _srcloc_str = bun_core::OwnedString::new(srcloc.str);
                ReentryCallSite {
                    source_url: srcloc.str.to_js(global_this)?,
                    line: srcloc.line,
                    column: srcloc.column,
                }
            }
        };
        let args = call_frame.arguments();
        let args_js = JSValue::create_array_from_iter(global_this, args.iter().copied(), Ok)?;

        let ctx = JSValue::create_empty_array(global_this, deferred_ctx::LEN)?;
        ctx.put_index(global_this, deferred_ctx::EXPECT_THIS, call_frame.this())?;
        ctx.put_index(global_this, deferred_ctx::CALLEE, call_frame.callee())?;
        ctx.put_index(global_this, deferred_ctx::ARGS, args_js)?;
        ctx.put_index(global_this, deferred_ctx::DEFERRED, deferred_js)?;
        ctx.put_index(global_this, deferred_ctx::CALL_SITE_ERROR, call_site_error)?;
        ctx.put_index(
            global_this,
            deferred_ctx::ORIGIN,
            JSValue::js_number_from_int32(origin as i32),
        )?;
        ctx.put_index(global_this, deferred_ctx::SUBJECT, subject)?;
        ctx.put_index(global_this, deferred_ctx::EPOCH, Self::epoch_to_ctx_slot(epoch))?;
        ctx.put_index(global_this, deferred_ctx::SRC_URL, call_site.source_url)?;
        ctx.put_index(
            global_this,
            deferred_ctx::SRC_LINE,
            JSValue::js_number_from_int32(call_site.line as i32),
        )?;
        ctx.put_index(
            global_this,
            deferred_ctx::SRC_COL,
            JSValue::js_number_from_int32(call_site.column as i32),
        )?;
        // Chained getters (`.not`, `.resolves`) mutate the shared wrapper's flags, so the
        // re-invocation must observe the flags THIS call saw, not the latest ones.
        ctx.put_index(
            global_this,
            deferred_ctx::FLAGS,
            JSValue::js_number_from_int32(self.flags.get().encode() as i32),
        )?;
        // A chained deferral carries the `.resolves`/`.rejects` subject settlement this
        // re-invocation already consumed, so every later pass resumes the Subject await
        // point from it and never re-reads the raw subject's internal slots.
        let carried_subject =
            self.with_reentry_window(|window| window.consumed_subject.get()).flatten();
        let (carried_rejected, carried_value, carried_subject_js) = match carried_subject {
            Some(settlement) => (
                JSValue::js_number_from_int32(settlement.rejected as i32),
                settlement.value,
                settlement.subject,
            ),
            None => (JSValue::UNDEFINED, JSValue::UNDEFINED, JSValue::UNDEFINED),
        };
        ctx.put_index(global_this, deferred_ctx::CARRIED_SUBJECT_REJECTED, carried_rejected)?;
        ctx.put_index(global_this, deferred_ctx::CARRIED_SUBJECT_VALUE, carried_value)?;
        ctx.put_index(global_this, deferred_ctx::CARRIED_SUBJECT, carried_subject_js)?;

        // Adopt the subject through the generic promise-resolve path: a promise subclass
        // or thenable (e.g. `Bun.$`'s lazy ShellPromise) is adopted via its own `.then` —
        // which is what starts it — while reactions attached directly to its internal
        // slots (`then2`) never would. A plain promise adopts natively (fast path).
        let tracked = js_promise::JSPromise::create(global_this);
        let tracked_js = tracked.to_js();
        if tracked.resolve(global_this, subject).is_err() {
            return Err(JsError::Terminated);
        }
        if global_this.has_exception() {
            // A hostile `then` getter threw during the adoption.
            return Err(JsError::Thrown);
        }
        // The reaction only runs on a later microtask, so it can never observe a missing
        // registration; from here on it owns the release the guard above was armed for.
        tracked_js.then2(
            global_this,
            ctx,
            Bun__Expect__onSubjectResolve,
            Bun__Expect__onSubjectReject,
        );
        scopeguard::ScopeGuard::into_inner(registration);
        Ok(deferred_js)
    }

    /// [`deferred_ctx::EPOCH`] encoding of an optional registration epoch: the epoch's
    /// int32 bit pattern, or `undefined` when nothing was registered.
    fn epoch_to_ctx_slot(epoch: Option<u32>) -> JSValue {
        match epoch {
            Some(epoch) => JSValue::js_number_from_int32(epoch as i32),
            None => JSValue::UNDEFINED,
        }
    }

    /// Inverse of [`Expect::epoch_to_ctx_slot`].
    fn epoch_from_ctx_slot(value: JSValue) -> Option<u32> {
        value.is_int32().then(|| value.as_int32() as u32)
    }

    /// Decode an int32 reaction-context slot written by
    /// [`Expect::defer_matcher`] (`SRC_LINE` / `SRC_COL`) back to its `u32`.
    fn u32_from_ctx_slot(value: JSValue) -> u32 {
        debug_assert!(value.is_int32());
        value.is_int32().then(|| value.as_int32() as u32).unwrap_or(0)
    }

    /// Count a deferred matcher promise on the owning test's sequence so the runner keeps
    /// the test open until it settles, and return the registration epoch the settle
    /// reaction must hand back to [`Expect::settle_pending_matcher_promise`]. `None`
    /// (nothing registered) degrades exactly like `expect_call_count` when no test entry
    /// owns the deferral: a concurrent group running 2+ sequences, a hook-only
    /// `beforeAll`/`afterAll` sequence, or outside `bun:test` (stale phase).
    fn register_pending_matcher_promise(&self) -> Option<u32> {
        let parent = self.parent.as_ref()?;
        let buntest_strong = parent.bun_test()?;
        let buntest = buntest_strong.get();
        let sequence = parent.phase.sequence(buntest)?;
        // A hook-only sequence has no test entry to derive a completion deadline from, so
        // a tracked deferral could park the run forever; fall back to the synchronous wait
        // instead. That wait ignores the hook timeout, so a never-settling subject in a
        // beforeAll/afterAll still blocks the run — the same behavior as released Bun.
        if sequence.test_entry.is_none() {
            return None;
        }
        Some(sequence.register_matcher_promise())
    }

    /// A deferral can only be tracked (and therefore gate its test's completion) when the
    /// owning sequence has a test entry to bound the wait; see
    /// [`Expect::register_pending_matcher_promise`]. Callers otherwise fall back to the
    /// pre-existing synchronous wait.
    fn can_track_matcher_promise(&self) -> bool {
        let Some(parent) = self.parent.as_ref() else { return false };
        let Some(buntest_strong) = parent.bun_test() else { return false };
        let buntest = buntest_strong.get();
        parent
            .phase
            .sequence(buntest)
            .is_some_and(|sequence| sequence.test_entry.is_some())
    }

    /// The settle reaction ran (or the deferral failed to attach): release the
    /// registration made at `epoch` and, if the owning sequence already ran out of
    /// entries and was only waiting on matcher promises, wake the runner so it
    /// re-evaluates completion (the same `run_next_tick` / `RunTestsTask` path
    /// `bun_test_then_or_catch` uses). A settlement whose epoch no longer matches — the
    /// per-test timeout abandoned it, or a retry/repeat attempt reset the sequence —
    /// never touches the later attempt's counter.
    fn settle_pending_matcher_promise(&self, global_this: &JSGlobalObject, epoch: Option<u32>) {
        let Some(epoch) = epoch else { return };
        let Some(parent) = self.parent.as_ref() else { return };
        let Some(buntest_strong) = parent.bun_test() else { return };
        let notify = {
            let buntest = buntest_strong.get();
            let Some(sequence) = parent.phase.sequence(buntest) else { return };
            sequence.settle_matcher_promise(epoch)
        };
        if !notify {
            return;
        }
        // `Start` re-evaluates the whole group (`step_group`); it never advances an
        // in-flight entry, so it cannot complete a test whose callback is still running.
        buntest_strong.get().add_result(bun_test::RefDataValue::Start);
        bun_test::BunTest::run_next_tick(
            &parent.buntest_weak,
            global_this,
            bun_test::RefDataValue::Start,
        );
    }

    /// The re-invoked matcher failed. Reject `D` PLAINLY (not as-handled), so a user
    /// `await`/`.catch` observes the failure, and record a provisional failure on the
    /// owning sequence: whether anyone adopted `D` is decided once, when that sequence
    /// completes (`Execution::commit_provisional_matcher_failures`). Until then the
    /// bun:test unhandled-rejection handler suppresses `D`'s own rejection report.
    fn record_provisional_matcher_failure(
        &self,
        global_this: &JSGlobalObject,
        deferred: &mut js_promise::JSPromise,
        exception: JSValue,
        epoch: Option<u32>,
    ) {
        use super::execution::ProvisionalMatcherFailure;

        let deferred_js = deferred.to_js();
        // Contexts with no owning sequence cannot decide "awaited or not" at a later
        // sequence completion: report the failure now, like any other unhandled error,
        // and settle `D` without an unhandled-rejection report of its own.
        let Some((parent, buntest_strong)) = self
            .parent
            .as_ref()
            .and_then(|parent| Some((parent, parent.bun_test()?)))
        else {
            deferred.set_handled();
            let _ = deferred.reject(global_this, Ok(exception));
            global_this.bun_vm().as_mut().run_error_handler(exception, None);
            return;
        };
        {
            let buntest = buntest_strong.get();
            if parent.phase.sequence(buntest).is_none() {
                // Multi-sequence concurrent group / stale phase: no single owning
                // sequence. Route through the shared handler so it is still reported.
                deferred.set_handled();
                let _ = deferred.reject(global_this, Ok(exception));
                buntest.on_uncaught_exception(global_this, Some(exception), true, &parent.phase);
                return;
            }
        }

        // Reject before re-borrowing the sequence: settling a promise never runs user JS
        // synchronously (reactions are queued), but it does enter the rejection tracker.
        if deferred.reject(global_this, Ok(exception)).is_err() {
            return; // terminated
        }
        let buntest = buntest_strong.get();
        let Some(sequence) = parent.phase.sequence(buntest) else { return };
        // The `expect()` was created inside a hook if the entry it captured at creation
        // time is not the sequence's test entry (e.g. a beforeEach of a `test.failing`).
        let in_hook = match &parent.phase {
            bun_test::RefDataValue::Execution { entry_data: Some(entry_data), .. } => {
                sequence.test_entry.is_none_or(|test_entry| {
                    !core::ptr::eq(test_entry.as_ptr().cast::<()>().cast_const(), entry_data.entry)
                })
            }
            _ => false,
        };
        sequence.provisional_matcher_failures.push(ProvisionalMatcherFailure {
            deferred: bun_jsc::Strong::create(deferred_js, global_this),
            exception: bun_jsc::Strong::create(exception, global_this),
            epoch: epoch.unwrap_or(sequence.matcher_epoch),
            in_hook,
            leaked: false,
        });
    }

    /// Best-effort: the failure surfaced from a promise-reaction job, so graft the user's
    /// `expect()` call-site frames (captured at defer time in `call_site_error`) onto the
    /// real exception, keeping its class, name, message, `cause`, extra properties — and
    /// any user frames of its own. Never leaves a pending exception.
    fn attributed_matcher_error(
        global_this: &JSGlobalObject,
        exception: JSValue,
        call_site_error: JSValue,
    ) -> JSValue {
        if !exception.is_object() || !call_site_error.is_object() {
            return exception;
        }
        match Self::graft_call_site_stack(global_this, exception, call_site_error) {
            Ok(()) | Err(JsError::Terminated) => {}
            Err(_) => {
                // Attribution is cosmetic; a throwing `stack` getter must not derail the
                // settle path or leak a pending exception out of the reaction.
                let _ = global_this.clear_exception_except_termination();
            }
        }
        exception
    }

    /// Append `call_site_error`'s user frames (`"\n    at ..."`, file/line included) to
    /// `exception`'s `stack` after any user frames of its own, keeping the exception's
    /// header (name and message) and every other property. An exception raised from user
    /// JS inside the re-invoked matcher keeps its real throw site; one raised natively
    /// from the reaction job has no user frames of its own, so the call-site frames are
    /// all it gets.
    fn graft_call_site_stack(
        global_this: &JSGlobalObject,
        exception: JSValue,
        call_site_error: JSValue,
    ) -> JsResult<()> {
        use bstr::ByteSlice;
        // The V8-format frame prefix every stack line Bun serializes starts with.
        const FRAME: &[u8] = b"\n    at ";
        // The reporter hides source-less native frames of an intact trace; keep that
        // parity by dropping their serialized form (`(unknown)`/`(native)` locations).
        fn is_native_frame(line: &[u8]) -> bool {
            line.ends_with(b"(unknown)")
                || line.ends_with(b"(native)")
                || line.ends_with(b" at unknown")
                || line.ends_with(b" at native")
        }
        let Some(site_stack) = call_site_error.get(global_this, "stack")?.filter(|v| v.is_string())
        else {
            return Ok(());
        };
        let site_stack =
            bun_core::OwnedString::new(site_stack.to_bun_string(global_this)?).to_utf8_bytes();
        // No user frames were captured at the call site: nothing to attribute with.
        let Some(site_frames_at) = site_stack.find(FRAME) else { return Ok(()) };
        // Reading `stack` materializes the exception's own (reaction-job) trace, so the
        // `put` below is what every later consumer (the failure reporter included) sees.
        let Some(own_stack) = exception.get(global_this, "stack")?.filter(|v| v.is_string()) else {
            return Ok(());
        };
        let own_stack =
            bun_core::OwnedString::new(own_stack.to_bun_string(global_this)?).to_utf8_bytes();
        let header_len = own_stack.find(FRAME).unwrap_or(own_stack.len());
        let mut grafted = Vec::with_capacity(own_stack.len() + (site_stack.len() - site_frames_at));
        grafted.extend_from_slice(&own_stack[..header_len]);
        // The exception's own user frames come first: they name the real throw site.
        let mut own_frames: Vec<&[u8]> = Vec::new();
        for line in own_stack[header_len..].split(|&byte| byte == b'\n') {
            if line.is_empty() || is_native_frame(line) {
                continue;
            }
            grafted.push(b'\n');
            grafted.extend_from_slice(line);
            own_frames.push(line);
        }
        // Then the call-site frames it does not already carry, so the failure also points
        // back at the user's `expect()` line.
        let mut grafted_a_frame = !own_frames.is_empty();
        for line in site_stack[site_frames_at..].split(|&byte| byte == b'\n') {
            if line.is_empty() || is_native_frame(line) || own_frames.contains(&line) {
                continue;
            }
            grafted.push(b'\n');
            grafted.extend_from_slice(line);
            grafted_a_frame = true;
        }
        if !grafted_a_frame {
            return Ok(());
        }
        // NOT mirrored onto own `sourceURL`/`line`/`column` properties: `put` would make
        // them enumerable (JSC materializes them DontEnum), so the reporter would dump
        // them as extra fields. The reporter takes the location from the frames instead.
        exception.put(
            global_this,
            "stack",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, &grafted)?,
        );
        Ok(())
    }

    /// The registration at `epoch` still belongs to the attempt currently occupying the
    /// owning sequence. A per-test timeout or a retry/repeat reset bumps `matcher_epoch`,
    /// abandoning every deferral registered before it.
    fn matcher_epoch_is_current(&self, epoch: Option<u32>) -> bool {
        let Some(epoch) = epoch else {
            // Never registered (untracked context): nothing can have been abandoned.
            return true;
        };
        let Some(parent) = self.parent.as_ref() else { return false };
        let Some(buntest_strong) = parent.bun_test() else { return false };
        let buntest = buntest_strong.get();
        let Some(sequence) = parent.phase.sequence(buntest) else { return false };
        sequence.matcher_epoch == epoch
    }

    /// Shared body of `Bun__Expect__onSubjectResolve/Reject`: re-invoke the deferred
    /// matcher now that the subject settled. A matcher failure rejects `D` plainly and
    /// records a provisional failure on the owning sequence; whether anyone adopted `D`
    /// is decided once, when that sequence completes (see
    /// [`Expect::record_provisional_matcher_failure`]).
    fn on_subject_settled(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        rejected: bool,
    ) -> JsResult<JSValue> {
        let [settled_value, ctx] = callframe.arguments_as_array::<2>();
        if !ctx.is_object() {
            debug_assert!(false); // `defer_matcher` always passes the context array
            return Ok(JSValue::UNDEFINED);
        }
        let expect_this = ctx.get_index(global_this, deferred_ctx::EXPECT_THIS)?;
        let callee = ctx.get_index(global_this, deferred_ctx::CALLEE)?;
        let args_js = ctx.get_index(global_this, deferred_ctx::ARGS)?;
        let deferred_js = ctx.get_index(global_this, deferred_ctx::DEFERRED)?;
        let call_site_error = ctx.get_index(global_this, deferred_ctx::CALL_SITE_ERROR)?;
        let origin = DeferralOrigin::from_ctx_slot(ctx.get_index(global_this, deferred_ctx::ORIGIN)?);
        let subject = ctx.get_index(global_this, deferred_ctx::SUBJECT)?;
        let epoch = Self::epoch_from_ctx_slot(ctx.get_index(global_this, deferred_ctx::EPOCH)?);
        let flags_snapshot =
            Flags::decode(Self::u32_from_ctx_slot(ctx.get_index(global_this, deferred_ctx::FLAGS)?) as FlagsCppType);
        let call_site = ReentryCallSite {
            source_url: ctx.get_index(global_this, deferred_ctx::SRC_URL)?,
            line: Self::u32_from_ctx_slot(ctx.get_index(global_this, deferred_ctx::SRC_LINE)?),
            column: Self::u32_from_ctx_slot(ctx.get_index(global_this, deferred_ctx::SRC_COL)?),
        };
        // The `.resolves`/`.rejects` subject settlement a chained deferral carried
        // forward (`undefined` for a first-pass deferral): re-seeded into the window so
        // this re-invocation's Subject await point never re-reads the raw subject.
        let carried_rejected = ctx.get_index(global_this, deferred_ctx::CARRIED_SUBJECT_REJECTED)?;
        let consumed_subject = if carried_rejected.is_int32() {
            Some(ReentrySettlement {
                origin: DeferralOrigin::Subject,
                subject: ctx.get_index(global_this, deferred_ctx::CARRIED_SUBJECT)?,
                value: ctx.get_index(global_this, deferred_ctx::CARRIED_SUBJECT_VALUE)?,
                rejected: carried_rejected.as_int32() != 0,
            })
        } else {
            None
        };

        let (Some(expect_ptr), Some(deferred_ptr)) =
            (Expect::from_js(expect_this), deferred_js.as_promise())
        else {
            debug_assert!(false); // `defer_subject` always packs an Expect and a JSPromise
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: `expect_ptr` is the live payload of the wrapper rooted by `ctx`.
        let expect: &Expect = unsafe { &*expect_ptr };
        // SAFETY: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
        let deferred = js_promise::JSPromise::opaque_mut(deferred_ptr);

        // The attempt this deferral belonged to is gone (per-test timeout or retry/repeat
        // reset): do not re-run the matcher — its side effects (snapshot counters, expect
        // counts) would land in the attempt now occupying the sequence.
        if !expect.matcher_epoch_is_current(epoch) {
            // Reject with the real reason, attributed to the user's `expect()` line.
            let stale = global_this.create_error_instance(format_args!(
                "Test attempt ended (timeout or retry) before the matcher promise settled"
            ));
            let stale = Self::attributed_matcher_error(global_this, stale, call_site_error);
            let _ = deferred.reject_as_handled(global_this, stale);
            expect.settle_pending_matcher_promise(global_this, epoch);
            return Ok(JSValue::UNDEFINED);
        }

        let arg_count = args_js.get_length(global_this)? as u32;
        let mut args: Vec<JSValue> = Vec::with_capacity(arg_count as usize);
        for i in 0..arg_count {
            args.push(args_js.get_index(global_this, i)?);
        }

        // Re-invoke the SAME matcher. Inside the reentry window, every await point resumes from
        // the stashed settlement: a subject deferral direction-checks it instead of
        // re-reading the subject's internal slots, and a call-produced deferral (async
        // `toThrow` / async custom matcher) never runs its producer a second time.
        // The re-invocation window (see [`ReentryWindow`]): every `JSValue` in it is
        // rooted by this reaction frame + `ctx` for the synchronous `callee.call` below.
        let window = ReentryWindow {
            expect: expect_ptr,
            settlement: Cell::new(Some(ReentrySettlement {
                origin,
                subject,
                value: settled_value,
                rejected,
            })),
            consumed_subject: Cell::new(consumed_subject),
            call_site,
            // Consumed (taken) only if this re-invocation defers again; see [`ReentryDeferred`].
            deferred: Cell::new(Some(ReentryDeferred { deferred: deferred_js, call_site_error })),
            flags: flags_snapshot,
        };
        let call_result = {
            // Restore the PREVIOUS window and flags — not null/default — even if the
            // matcher throws or a nested panic unwinds: a further settle reaction firing
            // inside this one (nested window) must hand back what it found. Armed before
            // the two `replace` calls below so no path can leave the stale pointer behind.
            let previous_window = expect.reentry_window.get();
            let previous_flags = expect.flags.get();
            let _restore = scopeguard::guard((), move |()| {
                expect.reentry_window.set(previous_window);
                expect.flags.set(previous_flags);
            });
            // The re-invoked matcher must observe the flags captured at defer time
            // ([`deferred_ctx::FLAGS`]): a later `.not`/`.resolves` on the same handle
            // already mutated the shared byte.
            expect.reentry_window.set(&window);
            expect.flags.set(window.flags);
            callee.call(global_this, expect_this, &args)
        };

        match call_result {
            Ok(result) => {
                // A re-invocation that deferred again returned the reused `D` itself: it
                // is settled by the follow-up settle reaction, and resolving `D` with
                // itself would reject it with a self-resolution TypeError. Otherwise `D`
                // resolves with undefined: matchers have no meaningful value (a custom
                // matcher returns the `Expect` for chaining, which must not leak into `D`
                // — resolving with it would even probe its `then` as a thenable).
                if result != deferred_js {
                    // Termination is the only failure; the VM is going down.
                    let _ = deferred.resolve(global_this, JSValue::UNDEFINED);
                }
            }
            Err(JsError::Terminated) => {
                // No JS may run; release the registration and propagate.
                expect.settle_pending_matcher_promise(global_this, epoch);
                return Err(JsError::Terminated);
            }
            Err(e) => {
                let raw = global_this.take_exception(e);
                // The failure was thrown from a promise-reaction job whose stack has no
                // user frames: attribute it to the `expect()` call site captured at defer
                // time, so the awaited rejection and the direct report both point there.
                let exception = Self::attributed_matcher_error(
                    global_this,
                    raw.to_error().unwrap_or(raw),
                    call_site_error,
                );
                // Whether the failure was "awaited" cannot be decided yet (the user may
                // adopt `D` any time before the test ends): reject `D` plainly and record
                // a provisional failure the owning sequence commits at completion.
                expect.record_provisional_matcher_failure(global_this, deferred, exception, epoch);
            }
        }
        // Exactly one decrement per registration: the reaction pair runs at most once,
        // and every arm above that returns early releases it first.
        expect.settle_pending_matcher_promise(global_this, epoch);
        Ok(JSValue::UNDEFINED)
    }
}

// `ZigGlobalObject::promiseHandlerID` (C++) compares the fn-ptr handed to
// `JSValue::then2` against `&Bun__Expect__onSubjectResolve` by identity, so these thunks
// must be the exported symbols themselves — see the equivalent note on
// `Bun__TestScope__Describe2__bunTestThen` in bun_test.rs.
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__Expect__onSubjectResolve(
        global: *mut JSGlobalObject,
        frame: *mut CallFrame,
    ) -> JSValue {
        // SAFETY: JSC passes non-null live pointers for both.
        let (global, frame) = unsafe { (&*global, &*frame) };
        bun_jsc::host_fn::to_js_host_fn_result(global, Expect::on_subject_settled(global, frame, false))
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__Expect__onSubjectReject(
        global: *mut JSGlobalObject,
        frame: *mut CallFrame,
    ) -> JSValue {
        // SAFETY: JSC passes non-null live pointers for both.
        let (global, frame) = unsafe { (&*global, &*frame) };
        bun_jsc::host_fn::to_js_host_fn_result(global, Expect::on_subject_settled(global, frame, true))
    }
}

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
#[inline]
fn get_custom_matcher_fn(this_value: JSValue, global_this: &JSGlobalObject) -> Option<JSValue> {
    // SAFETY: FFI call with valid JSValue and &JSGlobalObject
    let matcher_fn = unsafe { Bun__JSWrappingFunction__getWrappedFunction(this_value, global_this) };
    if matcher_fn.is_empty() { None } else { Some(matcher_fn) }
}

unsafe extern "C" {
    fn Bun__JSWrappingFunction__create(
        global_this: *const JSGlobalObject,
        symbol_name: *const bun_core::String,
        // C++: `Bun::NativeFunctionPtr` — a bare `EncodedJSValue (*)(JSGlobalObject*, CallFrame*)`.
        // Rust's `JSHostFn` is already the pointer type, so no extra `*const`.
        function_pointer: bun_jsc::JSHostFn,
        wrapped_fn: JSValue,
        strong: bool,
    ) -> JSValue;
    fn Bun__JSWrappingFunction__getWrappedFunction(this: JSValue, global_this: *const JSGlobalObject) -> JSValue;

    fn ExpectMatcherUtils__getSingleton(global_this: *const JSGlobalObject) -> JSValue;

    fn Expect__getPrototype(global_this: *const JSGlobalObject) -> JSValue;
    fn ExpectStatic__getPrototype(global_this: *const JSGlobalObject) -> JSValue;
}

// Exports: handled by #[unsafe(no_mangle)] on:
//   ExpectMatcherUtils_createSigleton, Expect_readFlagsAndProcessPromise, ExpectCustomAsymmetricMatcher__execute

#[cfg(test)]
mod tests {
    use super::*;

    fn test_trim_leading_whitespace_for_snapshot(src: &[u8], expected: &[u8]) {
        let mut cpy = vec![0u8; src.len()];

        let res = Expect::trim_leading_whitespace_for_inline_snapshot(src, &mut cpy);
        sanity_check(src, &res);

        assert_eq!(expected, res.trimmed);
    }

    fn sanity_check(input: &[u8], res: &TrimResult<'_>) {
        // sanity check: output has same number of lines & all input lines endWith output lines
        let mut input_iter = input.split(|&b| b == b'\n');
        let mut output_iter = res.trimmed.split(|&b| b == b'\n');
        loop {
            let next_input = input_iter.next();
            let next_output = output_iter.next();
            if next_input.is_none() {
                assert!(next_output.is_none());
                break;
            }
            assert!(next_output.is_some());
            assert!(next_input.unwrap().ends_with(next_output.unwrap()));
        }
    }

    #[allow(dead_code)]
    fn test_one(input: &[u8]) {
        let mut cpy = vec![0u8; input.len()];
        let res = Expect::trim_leading_whitespace_for_inline_snapshot(input, &mut cpy);
        sanity_check(input, &res);
    }

    #[test]
    fn trim_leading_whitespace_for_inline_snapshot() {
        test_trim_leading_whitespace_for_snapshot(
            b"\nHello, world!\n",
            b"\nHello, world!\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Hello, world!\n",
            b"\nHello, world!\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Object{\n    key: value\n  }\n",
            b"\nObject{\n  key: value\n}\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Object{\n  key: value\n\n  }\n",
            b"\nObject{\nkey: value\n\n}\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n    Object{\n  key: value\n  }\n",
            b"\n    Object{\n  key: value\n  }\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            "\n  \"æ™\n\n  !!!!*5897yhduN\"'\\`Il\"\n".as_bytes(),
            "\n\"æ™\n\n!!!!*5897yhduN\"'\\`Il\"\n".as_bytes(),
        );
    }
}
