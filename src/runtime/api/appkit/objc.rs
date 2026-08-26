//! `ObjCObject` / `ObjCClass` / `ObjCSelector` and the `objc*` binding
//! functions: the JavaScript face of `bun_appkit::dynamic`, which sends any
//! selector to any object or class. `src/js/bun/objc.ts` (`bun:objc`) wraps these in
//! the `objc` proxy layer (selector name mangling, `objc.classes`, handles).
//!
//! Ownership: a wrapper holds one reference to its object for as long as the
//! collector keeps the wrapper (or until the script's `release()`), and each
//! object has one wrapper while the script can reach it ([`canonical`]). The
//! functions of a block, a target or a script-defined class live in an
//! [`ObjCKeeper`], which the collector keeps for as long as the script can
//! reach the wrapper or native code holds the object.
//!
//! Everything here is per thread: the main thread and each Worker that loads
//! the module get their own handle table, hooks and release queue, and are
//! each an [`Owner`] the bridge hands stray blocks and instances back to.
//! [`retire`] lets go of a thread's half when it exits.

use core::any::Any;
use core::cell::{Cell, RefCell};
use core::mem::ManuallyDrop;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::rc::Rc;

use bun_collections::HashMap;
use bun_threading::Guarded;

use bun_appkit::dynamic::{self, Enc, Heavy, Kept, Plain, Receiver, Reply};
use bun_appkit::handoff::{self, Owner, Post};
use bun_appkit::script::{self, Call, ClassSpec, MethodSpec};
use bun_appkit::{DynClass, DynObject, DynValue, block};
use bun_jsc::ConcurrentTask::ConcurrentTask;
use bun_jsc::ManagedTask::ManagedTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, GlobalRef, JSBigInt, JSFunction, JSGlobalObject, JSUint8Array, JSValue, JsClass,
    JsResult, LoopKind, Posted, Strong, VmHandle, Weak,
};

use super::conv::{self, JsStr, Slot};
use crate::generated_classes::{js_ObjCKeeper, js_ObjCObject};

thread_local! {
    /// What the collector has finalized whose native half is still to be
    /// dropped; see [`drop_later`]. Never dropped as a whole.
    static RELEASED: RefCell<ManuallyDrop<Vec<Box<dyn Any>>>> =
        const { RefCell::new(ManuallyDrop::new(Vec::new())) };
    /// What `src/js/bun/objc.ts` hands over once; see [`Hooks`]. Never dropped
    /// by the thread-local: it goes in [`retire`] or lives as long as the module.
    static HOOKS: RefCell<Option<ManuallyDrop<Hooks>>> = const { RefCell::new(None) };
    /// The live wrapper of each object or class by address, so one object is
    /// one JavaScript object for as long as the script can reach it. Nothing
    /// that allocates on the JavaScript heap may run while this is borrowed:
    /// a collection would finalize wrappers, which come back here. Emptied
    /// by [`retire`], never dropped by the thread-local.
    static HANDLES: RefCell<ManuallyDrop<HashMap<usize, Weak<()>>>> =
        RefCell::new(ManuallyDrop::new(HashMap::default()));
    /// Every live [`Link`] on the thread, for [`retire`] to cut.
    static LINKS: RefCell<Vec<std::rc::Weak<Link>>> = const { RefCell::new(Vec::new()) };
    /// The [`Link`] of each named script class this thread defined, by
    /// class address, so a later load of the same script that defines the
    /// class again gets it pointed at that load's functions.
    static CLASS_LINKS: RefCell<HashMap<usize, Rc<Link>>> = RefCell::new(HashMap::default());
}

/// Whether [`retire`] has run on this thread: its JavaScript side is going
/// or gone, so nothing here may touch the heap any more.
fn retired() -> bool {
    handoff::this_thread().is_some_and(Owner::retired)
}

/// How a block, a target or a script class reaches the [`ObjCKeeper`] of
/// its functions: weakly, so the keeper goes once neither the script nor
/// native code holds the object, and from then on (or once [`retire`] has
/// cut the link) whatever asks gets no function.
struct Link(RefCell<Option<Weak<()>>>);

impl Link {
    fn new() -> Rc<Link> {
        let link = Rc::new(Link(RefCell::new(None)));
        LINKS.with_borrow_mut(|all| {
            // Forget the ones already dropped now and then, so the list
            // stays about as long as what is alive.
            if all.len().is_power_of_two() {
                all.retain(|l| l.strong_count() > 0);
            }
            all.push(Rc::downgrade(&link));
        });
        link
    }

    fn bind(&self, global: &JSGlobalObject, keeper: JSValue) {
        let before = self
            .0
            .borrow_mut()
            .replace(Weak::create_passive(keeper, global));
        Link::supersede(before.as_ref());
    }

    /// Lets go of the keeper (the collector may take it and its functions
    /// now, whoever still retains the object): from here on whatever asks
    /// gets no function, until a later [`bind`](Link::bind).
    fn cut(&self) {
        Link::supersede(self.0.borrow_mut().take().as_ref());
    }

    fn supersede(before: Option<&Weak<()>>) {
        if let Some(old) = before
            .and_then(Weak::get)
            .and_then(|k| k.as_class_ref::<ObjCKeeper>())
        {
            old.superseded.store(true, Ordering::Relaxed);
        }
    }

    /// What the keeper's `functions` slot holds, while there is a keeper.
    fn functions(&self) -> Option<JSValue> {
        let keeper = self.0.borrow().as_ref().and_then(Weak::get)?;
        js_ObjCKeeper::functions_get_cached(keeper).filter(|f| !f.is_undefined_or_null())
    }
}

/// Cuts every link on the thread; see [`Link::cut`].
fn cut_links() {
    let links = LINKS.with_borrow_mut(core::mem::take);
    for link in links.iter().filter_map(std::rc::Weak::upgrade) {
        link.cut();
    }
    drop(links);
}

/// The script side's half of the bridge, from `objcSetHooks`.
struct Hooks {
    /// The global object that loaded the module.
    global: GlobalRef,
    /// Applies a script-class method or block function to its receiver and
    /// arguments (turning the raw wrappers into the proxied handles scripts
    /// see), with the defining class in scope for `super`.
    dispatch: Strong,
    /// An array a send pushes (argument index, value) pairs onto for what
    /// the method left in its out-parameters; the script side moves each
    /// into the `{ value }` object it passed and empties the array.
    outs: Strong,
}

fn hooks<R>(global: &JSGlobalObject, f: impl FnOnce(&Hooks) -> R) -> JsResult<R> {
    HOOKS.with_borrow(|hooks| match hooks {
        Some(hooks) => Ok(f(hooks)),
        None => Err(global.throw_type_error(format_args!("objcSetHooks() was never called"))),
    })
}

/// The wrapper already handed out for `address` while it is alive (and, for
/// an object, not released by the script); otherwise `make`'s, remembered.
fn canonical(global: &JSGlobalObject, address: usize, make: impl FnOnce() -> JSValue) -> JSValue {
    let existing = HANDLES.with_borrow(|handles| handles.get(&address).and_then(Weak::get));
    if let Some(existing) = existing
        && !existing
            .as_class_ref::<ObjCObject>()
            .is_some_and(|o| o.object.is_released())
    {
        return existing;
    }
    remember(global, address, make())
}

/// `wrapper` as the one for `address` from now on.
fn remember(global: &JSGlobalObject, address: usize, wrapper: JSValue) -> JSValue {
    let weak = Weak::create_passive(wrapper, global);
    drop(HANDLES.with_borrow_mut(|handles| handles.insert(address, weak)));
    wrapper
}

/// Drops `address`'s entry once the wrapper it names has been collected (a
/// newer wrapper for the same address keeps it).
fn forget(address: usize) {
    HANDLES.with_borrow_mut(|handles| {
        if handles
            .get(&address)
            .is_some_and(|weak| weak.get().is_none())
        {
            handles.remove(&address);
        }
    });
}

/// How `bun_appkit` reaches this thread from another: a task on its event
/// loop that frees handed-back values or reports a call made elsewhere.
struct VmHome(VmHandle);

impl handoff::Home for VmHome {
    fn post(&self, post: Post) -> bool {
        fn posted(post: *mut Post) -> JsResult<()> {
            // SAFETY: what the enclosing function boxed for this one task.
            match *unsafe { bun_core::heap::take(post) } {
                Post::FreeDeferred => handoff::free_deferred(),
                Post::WrongThread { .. } if retired() => {}
                Post::WrongThread { what, why } => {
                    let global = VirtualMachine::get().global();
                    let err =
                        conv::throw(global, bun_appkit::Error::CalledOnOtherThread { what, why });
                    let _ = bun_jsc::task::report_error_or_terminate(global, err);
                }
                // Dropped unmade: the thread's script side is gone.
                Post::Run(_) if retired() => {}
                Post::Run(call) => {
                    release_finalized();
                    call();
                }
            }
            Ok(())
        }
        let task = ConcurrentTask::create(ManagedTask::new_owned(
            bun_core::heap::into_raw(Box::new(post)),
            posted,
        ));
        match self.0.post(LoopKind::Regular, task) {
            Posted::Queued => true,
            Posted::Refused(task) => {
                // SAFETY: refused, so still ours; this frees the boxed `Post` too.
                unsafe { ConcurrentTask::release_refused(task) };
                false
            }
        }
    }
}

/// This thread's JavaScript side is shutting down (a Worker ending, or the
/// process): free what other threads handed back while the heap is still
/// here, then cut every link, hook and wrapper the bridge holds on it and
/// tell `bun_appkit` the thread is gone, so a block or script method
/// reached later (here during teardown, or on another thread) runs nothing.
/// Objective-C objects the collector frees from now on are released on the
/// spot.
extern "C" fn retire(_: *mut core::ffi::c_void) {
    let Some(owner) = handoff::this_thread() else {
        return;
    };
    if owner.retired() {
        return;
    }
    handoff::free_deferred();
    owner.retire();
    release_finalized();
    drop(CLASS_LINKS.with_borrow_mut(core::mem::take));
    cut_links();
    if let Some(hooks) = HOOKS.with_borrow_mut(Option::take) {
        drop(ManuallyDrop::into_inner(hooks));
    }
    drop(UNDER_SEND.with(|(_, parked)| parked.take()));
    drop(HANDLES.with_borrow_mut(|handles| core::mem::take(&mut **handles)));
}

/// Applies `function` to `receiver` (or `undefined`) and `args` through the
/// dispatch function, `class` (or `undefined`) being where `super` sends
/// from inside it start. `None` when it threw, which the event loop reported.
fn dispatch(
    global: &JSGlobalObject,
    function: JSValue,
    receiver: JSValue,
    args: JSValue,
    class: JSValue,
) -> JsResult<Option<JSValue>> {
    let dispatch = hooks(global, |hooks| hooks.dispatch.get())?;
    let args = [function, receiver, args, class];
    let block = receiver.is_undefined();
    Ok(super::slots::enter(
        global,
        dispatch,
        JSValue::UNDEFINED,
        &args,
        |global, err| raised(global, err, block),
    ))
}

/// `returned` converted for a `ret`-typed return slot of `method`; a misfit
/// is the script's error, reported like a throw from the function itself,
/// and reads as `None` just as a throw does.
fn returned(
    global: &JSGlobalObject,
    method: &str,
    ret: &Enc,
    block: bool,
    returned: JsResult<Option<JSValue>>,
) -> Option<DynValue> {
    let converted = returned.and_then(|returned| match returned {
        // Whatever a void function returns is dropped, as JavaScript does.
        Some(_) if *ret == Enc::Void => Ok(Some(DynValue::Void)),
        Some(value) => conv::dyn_value(global, method, Slot::Return, ret, value).map(Some),
        None => Ok(None),
    });
    match converted {
        Ok(value) => value,
        Err(err) => {
            raised(global, err, block);
            None
        }
    }
}

/// A call from native code into a script function: which function, on
/// what, typed how.
#[derive(Clone, Copy)]
struct JsCall<'a> {
    function: JSValue,
    /// `undefined` for a block.
    receiver: JSValue,
    /// The defining class, for `super`; `undefined` for a block.
    class: JSValue,
    method: &'a str,
    params: &'a [Enc],
    ret: &'a Enc,
}

/// How a block or script-class method reaches its function: `args`
/// converted the way results are (an out-parameter as a `{ value }` cell),
/// the function applied to the receiver, its result converted for `ret`,
/// and the cells read back for `params`' out-parameters.
fn call_js(global: &JSGlobalObject, call: JsCall<'_>, args: Vec<DynValue>) -> Reply {
    let JsCall {
        function,
        receiver,
        class,
        method,
        params,
        ret,
    } = call;
    // Each converted argument is in the array, and so reachable, as soon as
    // it exists; the cells are read back out of the array after the call.
    let args =
        JSValue::create_array_from_iter(global, args.into_iter().zip(params), |(arg, enc)| {
            let value = conv::dyn_to_js(global, arg)?;
            Ok(match enc {
                Enc::Out(_) => {
                    let cell = JSValue::create_empty_object(global, 1);
                    cell.put(global, b"value", value);
                    cell
                }
                _ => value,
            })
        });
    let block = receiver.is_undefined();
    let args = match args {
        Ok(args) => args,
        Err(err) => {
            return Reply {
                value: returned(global, method, ret, block, Err(err)),
                outs: Vec::new(),
            };
        }
    };
    let value = returned(
        global,
        method,
        ret,
        block,
        dispatch(global, function, receiver, args, class),
    );
    let read_outs = || -> JsResult<Vec<(usize, DynValue)>> {
        let mut read = Vec::new();
        for (index, enc) in params.iter().enumerate() {
            let Enc::Out(pointee) = enc else {
                continue;
            };
            let cell = args.get_index(global, index as u32)?;
            if let Some(value) = cell.get(global, "value")? {
                let slot = Slot::Arg(index);
                read.push((
                    index,
                    conv::dyn_value(global, method, slot, &pointee.enc(), value)?,
                ));
            }
        }
        Ok(read)
    };
    let outs = read_outs().unwrap_or_else(|err| {
        // A `value` that does not convert (or a getter that throws) counts
        // as the function throwing.
        raised(global, err, block);
        Vec::new()
    });
    args.ensure_still_alive();
    Reply { value, outs }
}

fn selector_arg(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<conv::Utf8> {
    Ok(JsStr::new(global, value, format_args!("{what} selector"))?.to_utf8())
}

/// Queues the native half of a wrapper the collector has finalized (an
/// `ObjCObject`, `ObjCKeeper`, `ObjCFunction` or `AppKitView`) to be dropped
/// on the next event loop turn, or at the top of the next send, rather than
/// inside the collection: dropping it gives an Objective-C reference back
/// (an object's last release runs its `dealloc`; a view lets go of its
/// delegate), which can send messages that script-defined methods answer,
/// and JavaScript cannot run inside a collection. Once the thread has
/// [`retire`]d there is no later, and no script method a `dealloc` could
/// reach runs any more, so it is dropped here.
pub(super) fn drop_later(item: Box<dyn Any>) {
    if retired() {
        dynamic::drop_pooled(item);
        return;
    }
    let first = RELEASED.with_borrow_mut(|queue| {
        queue.push(item);
        queue.len() == 1
    });
    if first {
        fn release(_: *mut u8) -> JsResult<()> {
            release_finalized();
            Ok(())
        }
        static TAG: u8 = 0;
        VirtualMachine::get()
            .event_loop_mut()
            .enqueue_task(ManagedTask::new(
                core::ptr::from_ref(&TAG).cast_mut(),
                release,
            ));
    }
}

/// Drops what the collector has finalized since this last ran; see
/// [`drop_later`].
fn release_finalized() {
    let released = RELEASED.with_borrow_mut(|queue| core::mem::take(&mut **queue));
    if !released.is_empty() {
        dynamic::drop_pooled(released);
    }
}

/// Looks the method up, converts `args` by its signature, sends, and converts
/// the result back.
fn send(
    global: &JSGlobalObject,
    receiver: Receiver<'_>,
    frame: &CallFrame,
    what: &str,
) -> JsResult<JSValue> {
    // Here rather than only on the next event-loop turn, so a loop of sends
    // that never yields cannot pile up what the collector already let go.
    release_finalized();
    let args = frame.arguments();
    let sel = selector_arg(global, frame.argument(0), what)?;
    let args = args.get(1..).unwrap_or_default();
    let sig = conv::check(global, dynamic::signature(receiver, &sel))?;
    let result = send_as(global, receiver, &sig, args)?;
    // Where a script-class instance is born (`new`, `alloc().init…()`,
    // `copy`): pin its wrapper from the start; see [`ObjCObject::keep_instance`].
    if sig.family.returns_retained() {
        ObjCObject::keep_instance(global, result)?;
    }
    Ok(result)
}

/// Converts `args` by `sig`, sends (or calls the block), and converts the
/// result back.
fn send_as(
    global: &JSGlobalObject,
    receiver: Receiver<'_>,
    sig: &dynamic::Signature,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let (mut values, _pinned) = arguments_as(global, sig, args)?;
    let result = bridged(global, || dynamic::invoke(receiver, sig, &mut values))?;
    result_of(global, result, values)
}

thread_local! {
    /// How many bridged calls ([`bridged`]) this thread is inside, and the
    /// first error a script function threw straight under each of them that
    /// has one to rethrow, innermost last, with the depth it was thrown at.
    static UNDER_SEND: (Cell<usize>, RefCell<Vec<(usize, Strong)>>) =
        const { (Cell::new(0), RefCell::new(Vec::new())) };
}

/// Runs `call`, a send, block call or C-function call a script makes. What
/// a script function throws while native code the call reached is running
/// it (a comparator, a delegate method answered before the send returns)
/// cannot unwind through that native code, so [`dispatch`] parks it with
/// [`raised`]; the call here whose native code ran the function (the
/// innermost one around the throw, not the outermost) throws it on once
/// the native side has returned, ahead of its own result or error.
fn bridged<T>(
    global: &JSGlobalObject,
    call: impl FnOnce() -> bun_appkit::Result<T>,
) -> JsResult<T> {
    struct Depth(usize);
    impl Drop for Depth {
        fn drop(&mut self) {
            UNDER_SEND.with(|(depth, _)| depth.set(self.0 - 1));
        }
    }
    let depth = Depth(UNDER_SEND.with(|(depth, _)| {
        depth.set(depth.get() + 1);
        depth.get()
    }));
    let result = call();
    let parked = UNDER_SEND.with(|(_, parked)| {
        let mut parked = parked.borrow_mut();
        match parked.last() {
            Some(&(under, _)) if under == depth.0 => parked.pop(),
            _ => None,
        }
    });
    drop(depth);
    if let Some((_, error)) = parked {
        // The send's own error, if any, came second and is dropped unthrown.
        drop(result);
        return Err(global.throw_value(error.get()));
    }
    conv::check(global, result)
}

/// What a script function threw (or the misfit it returned) while native
/// code was calling it. A block's (`rethrow`), when a bridged call of this
/// thread's script is underneath, is parked for [`bridged`] to rethrow: the
/// block is that call's argument (a comparator, an enumeration body) and its
/// error is the caller's. Anything else (a delegate method, a target's
/// action, an observer: listeners, whoever set the call off) is reported as
/// uncaught and the native caller carries on, as it is when AppKit calls
/// from the event loop. A second throw under the same call is dropped for
/// the first.
fn raised(global: &JSGlobalObject, err: bun_jsc::JsError, rethrow: bool) {
    let under = UNDER_SEND.with(|(depth, _)| depth.get());
    let under_send = under > 0;
    // A termination (the thread's script is being stopped) is not the
    // script's to catch; the report path stands the VM down.
    if !rethrow
        || !under_send
        || err != bun_jsc::JsError::Thrown
        || global.has_pending_termination_exception()
    {
        let _ = bun_jsc::task::report_error_or_terminate(global, err);
        return;
    }
    let error = global.take_exception(err);
    UNDER_SEND.with(|(_, parked)| {
        let mut parked = parked.borrow_mut();
        if parked.last().is_none_or(|&(earlier, _)| earlier != under) {
            parked.push((under, Strong::create(error, global)));
        }
    });
}

/// The `ArrayBuffer`s lent as C-array or pointer arguments for one send
/// ([`DynValue::Bytes`]), pinned so a script function the send reaches
/// cannot detach one under the callee; unpinned when the send is over.
#[derive(Default)]
struct Pinned(Vec<bun_jsc::ArrayBuffer>);

impl Drop for Pinned {
    fn drop(&mut self) {
        for buffer in &self.0 {
            buffer.unpin();
        }
    }
}

/// `args` converted by `sig`, one for one, and the pins taken for them.
fn arguments_as(
    global: &JSGlobalObject,
    sig: &dynamic::Signature,
    args: &[JSValue],
) -> JsResult<(Vec<DynValue>, Pinned)> {
    // Out-parameters at the end may be left off: each is passed as NULL. A
    // variadic method's variable arguments follow the named ones as objects.
    let variadic = sig.variadic().is_some();
    let complete = args.len() == sig.args.len()
        || (variadic && args.len() > sig.args.len())
        || (args.len() < sig.args.len()
            && sig.args[args.len()..]
                .iter()
                .all(|enc| matches!(enc, Enc::Out(_))));
    if !complete {
        return Err(conv::throw(
            global,
            bun_appkit::Error::ArgCount {
                method: sig.method().to_owned(),
                expected: sig.args.len(),
                got: args.len(),
            },
        ));
    }
    let mut values = Vec::with_capacity(sig.args.len().max(args.len()));
    let mut pinned = Pinned::default();
    for (index, enc) in sig.args.iter().enumerate() {
        values.push(match args.get(index) {
            Some(value) => {
                // Pinned before its address is read: pinning a typed array
                // that has no ArrayBuffer yet moves its storage into one.
                if matches!(enc, Enc::Buffer(_) | Enc::Pointer)
                    && let Some(buffer) = value.as_pinned_arraybuffer(global)
                {
                    pinned.0.push(buffer);
                }
                conv::dyn_arg(global, sig, index, enc, *value)?
            }
            None => DynValue::Nil,
        });
    }
    if variadic {
        for (index, value) in args.iter().enumerate().skip(sig.args.len()) {
            values.push(conv::dyn_arg(global, sig, index, &Enc::Object, *value)?);
        }
    }
    Ok((values, pinned))
}

/// `result` converted back, and what the call left in the out-parameters
/// among `values` handed to the script side's `outs` hook.
fn result_of(
    global: &JSGlobalObject,
    result: DynValue,
    values: Vec<DynValue>,
) -> JsResult<JSValue> {
    let result = conv::dyn_to_js(global, result)?;
    if values.iter().any(|v| matches!(v, DynValue::Out(Some(_)))) {
        let outs = hooks(global, |hooks| hooks.outs.get())?;
        for (index, value) in values.into_iter().enumerate() {
            if let DynValue::Out(Some(out)) = value {
                outs.push(global, JSValue::js_number(index as f64))?;
                outs.push(global, conv::dyn_to_js(global, *out)?)?;
            }
        }
    }
    Ok(result)
}

/// The references [`Kept::retain_count`] sees that are the bridge's own:
/// the wrapper's [`DynObject`]'s and the [`Kept`]'s.
const OWN_REFERENCES: usize = 2;

/// One retained Objective-C object. `src/js/bun/objc.ts` wraps it in a Proxy that
/// turns property access into bound `msgSend` calls.
#[bun_jsc::JsClass]
pub struct ObjCObject {
    object: DynObject,
    heavy: Heavy,
    /// [`DynObject::estimated_size`], reported to the collector (which reads
    /// it on any thread): taken when wrapped, and again after each send
    /// through the wrapper to an object that can grow ([`Heavy::grows`]).
    size: AtomicUsize,
}

impl ObjCObject {
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<ObjCObject>> {
        Err(_global.throw_illegal_constructor())
    }

    /// The object's one wrapper (a class object's is an [`ObjCClass`]).
    pub(super) fn wrap(global: &JSGlobalObject, object: DynObject) -> JSValue {
        if let Some(class) = object.as_class() {
            return ObjCClass::wrap(global, class);
        }
        let address = object.address();
        let make = || {
            let heavy = object.heavy();
            let size = object.estimated_size(heavy);
            JsClass::to_js(
                ObjCObject {
                    object,
                    heavy,
                    size: AtomicUsize::new(size),
                },
                global,
            )
        };
        match address {
            // An `alloc` awaiting its `init…` stands for no object yet.
            0 => make(),
            _ => canonical(global, address, make),
        }
    }

    /// Starts keeping `functions` (a function, or a table of them) for
    /// native code that calls them through `wrapper`'s object; see
    /// [`ObjCKeeper`]. `wrapper` is the `ObjCObject` itself, not its proxy.
    fn keep(global: &JSGlobalObject, wrapper: JSValue, functions: JSValue) -> JsResult<JSValue> {
        let Some(this) = wrapper.as_class_ref::<ObjCObject>() else {
            return Err(global.throw_type_error(format_args!("expected an ObjCObject")));
        };
        if ObjCObject::keeps(wrapper) {
            return Err(conv::throw(
                global,
                bun_appkit::Error::InvalidState("this object already carries script functions"),
            ));
        }
        let kept = conv::check(global, Kept::new(&this.object))?;
        let keeper = ObjCKeeper::make(global, Some(kept), functions);
        js_ObjCKeeper::wrapper_set_cached(keeper, global, wrapper);
        js_ObjCObject::keeper_set_cached(wrapper, global, keeper);
        Ok(keeper)
    }

    /// Whether [`ObjCObject::keep`] has run on `wrapper`.
    fn keeps(wrapper: JSValue) -> bool {
        ObjCObject::keeper(wrapper).is_some()
    }

    fn keeper<'a>(wrapper: JSValue) -> Option<&'a ObjCKeeper> {
        js_ObjCObject::keeper_get_cached(wrapper)
            .filter(|k| !k.is_undefined_or_null())
            .and_then(|k| k.as_class_ref::<ObjCKeeper>())
    }

    /// An instance of a script-defined class is where the script keeps
    /// that instance's state (a `WeakMap` keyed by the handle, say), so its
    /// wrapper must stay the one for as long as native code holds the
    /// object, not only while the script does: it gets a keeper that keeps
    /// no functions (the class's keeper has those). `wrapper` may be any
    /// send's result; only a live, unkept `ObjCObject` of such a class is
    /// touched.
    pub(super) fn keep_instance(global: &JSGlobalObject, wrapper: JSValue) -> JsResult<()> {
        if let Some(this) = wrapper.as_class_ref::<ObjCObject>()
            && !ObjCObject::keeps(wrapper)
            && !this.object.is_released()
            && script::defines_class_of(&this.object)
        {
            ObjCObject::keep(global, wrapper, JSValue::NULL)?;
        }
        Ok(())
    }

    pub(super) fn object(&self) -> &DynObject {
        &self.object
    }

    /// Called by the collector, on any thread.
    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<ObjCObject>() + self.size.load(Ordering::Relaxed)
    }

    /// Reads the object's size again after a send that may have grown it,
    /// and tells the collector about the growth now rather than at its next
    /// visit, so a loop that builds a large buffer counts towards a collection.
    fn weigh(&self, global: &JSGlobalObject) {
        let now = self.object.estimated_size(self.heavy);
        let before = self.size.swap(now, Ordering::Relaxed);
        if now > before {
            global.vm().report_extra_memory(now - before);
        }
    }

    /// See [`drop_later`]: the reference goes back later, not from here.
    pub fn finalize(self: Box<Self>) {
        if self.object.address() != 0 {
            forget(self.object.address());
        }
        if self.object.holds_reference() {
            drop_later(self);
        }
    }

    /// `msgSend(selector, ...args)`.
    pub fn msg_send(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let result = send(
            global,
            Receiver::Object(&self.object),
            frame,
            "ObjCObject.msgSend()",
        )?;
        if self.heavy.grows() {
            self.weigh(global);
        }
        ObjCObject::consumed(frame.this());
        Ok(result)
    }

    /// After a send that may have been an `init…`: a wrapper the send
    /// consumed stands for nothing now, so its keeper hands its reference
    /// back (the wrapper the result got has a keeper of its own), as
    /// [`release`](Self::release) does; otherwise the two keepers would each
    /// see the other's reference as native code's and pin both for good.
    fn consumed(wrapper: JSValue) {
        if let Some(this) = wrapper.as_class_ref::<ObjCObject>()
            && this.object.is_released()
            && let Some(keeper) = ObjCObject::keeper(wrapper)
            && !keeper.keeps_functions(wrapper)
        {
            keeper.let_go();
        }
    }

    pub fn get_class_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let name = conv::check(global, self.object.class_name())?;
        conv::str_to_js(global, &name)
    }

    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::from_uint64_no_truncate(global, self.object.address() as u64)
    }

    /// Ends the script's use of the object through this wrapper: every later
    /// send throws. The reference goes now, unless native code may still
    /// call functions kept for it (a block, a target); then it goes with the
    /// wrapper. A keeper that only pins the wrapper (a script-class
    /// instance) is stood down, so the collector may take both once the
    /// script drops the handle. Idempotent.
    pub fn release(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        match ObjCObject::keeper(frame.this()) {
            Some(keeper) if keeper.keeps_functions(frame.this()) => self.object.close(),
            Some(keeper) => {
                keeper.let_go();
                self.object.release();
            }
            None => self.object.release(),
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_released(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.object.is_released()))
    }

    /// `-description`.
    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let text = conv::check(global, self.object.description())?;
        conv::utf16_to_js(global, &text)
    }
}

/// The functions native code calls through one block, target or
/// script-defined class: a block's function, a target's table of them by
/// selector, or a class's array of them in definition order, in the
/// `functions` slot. The collector keeps this cell while the script can reach
/// the block's or target's wrapper (whose `keeper` slot points here) and,
/// asked through [`ObjCKeeper::has_pending_activity`], while native code holds
/// the object; the `wrapper` slot points back, so that wrapper stays the
/// object's one handle for as long. An instance of a script class gets one
/// with no functions, for that pinning alone. A class's keeper is kept for good.
#[bun_jsc::JsClass(no_constructor)]
pub struct ObjCKeeper {
    /// `None` for a script-defined class.
    kept: Option<Kept>,
    /// Its [`Link`] was bound to a newer keeper (the class was defined
    /// again by a later load of the script): nothing reads this one now.
    superseded: AtomicBool,
}

impl ObjCKeeper {
    fn make(global: &JSGlobalObject, kept: Option<Kept>, functions: JSValue) -> JSValue {
        let keeper = JsClass::to_js(
            ObjCKeeper {
                kept,
                superseded: AtomicBool::new(false),
            },
            global,
        );
        js_ObjCKeeper::functions_set_cached(keeper, global, functions);
        keeper
    }

    /// Whether the `functions` slot holds any (a block's, a target's); an
    /// instance keeper's holds `null`. `wrapper` is the `ObjCObject` whose
    /// keeper this is.
    fn keeps_functions(&self, wrapper: JSValue) -> bool {
        js_ObjCObject::keeper_get_cached(wrapper)
            .and_then(js_ObjCKeeper::functions_get_cached)
            .is_some_and(|f| !f.is_undefined_or_null())
    }

    /// Called by the collector, on any thread: whether native code holds a
    /// reference to the object whose functions this keeps, so that they must
    /// stay although the script cannot reach the wrapper.
    pub fn has_pending_activity(&self) -> bool {
        if self.superseded.load(Ordering::Relaxed) {
            return false;
        }
        match &self.kept {
            Some(kept) => kept.retain_count() > OWN_REFERENCES,
            None => true,
        }
    }

    /// Hands the kept reference back now, so that a wrapper made for the
    /// same object later (another keeper for it) counts references right;
    /// the keeper then holds nothing for the collector to wait on.
    fn let_go(&self) {
        self.superseded.store(true, Ordering::Relaxed);
        if let Some(kept) = &self.kept {
            kept.let_go();
        }
    }

    /// See [`drop_later`]: the reference goes back later, not from here.
    pub fn finalize(self: Box<Self>) {
        if self.kept.is_some() {
            drop_later(self);
        }
    }
}

/// One Objective-C class.
#[bun_jsc::JsClass]
pub struct ObjCClass {
    class: DynClass,
}

impl ObjCClass {
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<ObjCClass>> {
        Err(_global.throw_illegal_constructor())
    }

    /// The class's one wrapper.
    pub(super) fn wrap(global: &JSGlobalObject, class: DynClass) -> JSValue {
        canonical(global, class.address(), || {
            JsClass::to_js(ObjCClass { class }, global)
        })
    }

    pub(super) fn class(&self) -> DynClass {
        self.class
    }

    /// `msgSend(selector, ...args)`, sent to the class object.
    pub fn msg_send(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        send(
            global,
            Receiver::Class(&self.class),
            frame,
            "ObjCClass.msgSend()",
        )
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.class.name())
    }

    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::from_uint64_no_truncate(global, self.class.address() as u64)
    }

    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.class.name())
    }
}

/// `new ObjCSelector(name)` (`objc.sel(name)`): a selector name marked as
/// one, so it fits a `SEL` argument and nothing else.
#[bun_jsc::JsClass]
pub struct ObjCSelector {
    name: String,
}

impl ObjCSelector {
    pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<ObjCSelector>> {
        let name = selector_arg(global, frame.argument(0), "objc.sel(name):")?.into_string();
        if name.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!(
                "objc.sel(name): name must be a non-empty string"
            )));
        }
        Ok(Box::new(ObjCSelector { name }))
    }

    pub(super) fn name(&self) -> &str {
        &self.name
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.name)
    }

    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.name)
    }
}

/// `objcLookupClass(name)`: the class, or a TypeError naming it.
#[bun_jsc::host_fn]
fn objc_lookup_class(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = JsStr::new(global, frame.argument(0), format_args!("class name"))?.to_utf8();
    let class = conv::check(global, dynamic::lookup_class(&name))?;
    Ok(ObjCClass::wrap(global, class))
}

/// `objcJs(value)`: Foundation value objects as plain JavaScript data; any
/// other value (wrapped or not) comes back as it was.
#[bun_jsc::host_fn]
fn objc_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    let Some(wrapper) = conv::objc_object(value) else {
        return Ok(value);
    };
    match conv::check(global, wrapper.object.to_plain())? {
        Plain::Other(_) => Ok(value),
        plain => plain_to_js(global, plain),
    }
}

fn plain_to_js(global: &JSGlobalObject, plain: Plain) -> JsResult<JSValue> {
    match plain {
        Plain::Null => Ok(JSValue::NULL),
        Plain::String(text) => conv::utf16_to_js(global, &text),
        Plain::Number(n) => Ok(JSValue::js_number(n)),
        Plain::Integer(n) => conv::i64_to_js(global, n),
        Plain::Unsigned(n) => conv::u64_to_js(global, n),
        Plain::Boolean(b) => Ok(JSValue::js_boolean(b)),
        Plain::Data(bytes) => JSUint8Array::from_bytes(global, bytes.into_boxed_slice()),
        Plain::Date(milliseconds) => Ok(JSValue::from_date_number(global, milliseconds)),
        Plain::Array(items) => JSValue::create_array_from_iter(global, items.into_iter(), |item| {
            plain_to_js(global, item)
        }),
        Plain::Dictionary(entries) => {
            let object = JSValue::create_empty_object(global, entries.len());
            for (key, value) in entries {
                let value = plain_to_js(global, value)?;
                object.put_may_be_index(global, &bun_core::String::clone_utf16(&key), value)?;
            }
            Ok(object)
        }
        Plain::Other(object) => Ok(ObjCObject::wrap(global, object)),
    }
}

/// `objcNs(value)`: the Foundation object for a JavaScript value (`null` for `null`).
#[bun_jsc::host_fn]
fn objc_ns(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    match conv::ns_value(global, frame.argument(0), format_args!("objc.ns()"))? {
        Some(object) => Ok(ObjCObject::wrap(global, object)),
        None => Ok(JSValue::NULL),
    }
}

/// `objcLookupProtocol(name)`: the `Protocol` object as a handle, or a TypeError naming it.
#[bun_jsc::host_fn]
fn objc_lookup_protocol(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = JsStr::new(global, frame.argument(0), format_args!("protocol name"))?.to_utf8();
    let protocol = conv::check(global, dynamic::lookup_protocol(&name))?;
    Ok(ObjCObject::wrap(global, protocol))
}

// ─────────────────────────── script-defined classes ───────────────────────────

/// How native code reaches the functions a script gave: through the
/// [`Link`] to their keeper, as a block (the `functions` slot is the
/// function), a script-defined class (an array, by [`Call::index`]) or the
/// targets class (each instance's own table, by selector; the link is the
/// instance's [`JsInstance`], not this value's). One value per block or
/// class, dropped when the block's last reference goes; classes never go.
enum Handler {
    Block(Rc<Link>),
    Class(Rc<Link>),
    Targets,
}

/// What `objc.target()` attaches to one instance of [`TARGETS`]: the way to
/// the keeper of its table, an object whose function-valued properties,
/// named by selector, are the instance's methods. Dropped when the instance
/// deallocates.
struct JsInstance {
    link: Rc<Link>,
}

/// `objc.target()`'s one class, defined by whichever thread makes a target
/// first; its methods run on the thread that attached the instance.
static TARGETS: Guarded<Option<DynClass>> = Guarded::new(None);

/// Where the function for one call is in what a keeper holds.
#[derive(Clone, Copy)]
enum Pick<'a> {
    /// At this index of the array of a class's method functions.
    Index(usize),
    /// Under this selector in a target's table.
    Key(&'a str),
    /// The kept value is the function (a block's).
    Itself,
}

impl Handler {
    /// Finds the function for `method` and applies it. No keeper (the script
    /// dropped the object and the collector took its wrapper while a weak
    /// holder could still message it; the global that made it was replaced;
    /// the thread is retiring) answers zero and says nothing, as the `nil`
    /// the holder is about to read would. A keeper whose table lacks the
    /// function is the script's doing and is reported like a throw.
    fn answer(
        &self,
        method: &str,
        receiver: Option<(DynObject, DynClass)>,
        pick: Pick<'_>,
        functions: Option<JSValue>,
        args: Vec<DynValue>,
        params: &[Enc],
        ret: &Enc,
    ) -> Reply {
        const NOTHING: Reply = Reply {
            value: None,
            outs: Vec::new(),
        };
        let global = VirtualMachine::get().global();
        let Some(kept) = functions else {
            return NOTHING;
        };
        let picked = match pick {
            Pick::Index(index) => kept.get_index(global, index as u32).map(Some),
            Pick::Key(selector) => kept.get(global, selector),
            Pick::Itself => Ok(Some(kept)),
        };
        let function = match picked {
            Ok(Some(function)) if function.is_callable() => Ok(function),
            Err(err) => Err(err),
            _ => Err(conv::throw(
                global,
                bun_appkit::Error::FunctionGone(method.to_owned()),
            )),
        };
        let function = match function {
            Ok(function) => function,
            Err(err) => {
                return Reply {
                    value: returned(global, method, ret, receiver.is_none(), Err(err)),
                    outs: Vec::new(),
                };
            }
        };
        let (receiver, class) = match receiver {
            Some((receiver, class)) => {
                let receiver = ObjCObject::wrap(global, receiver);
                if let Err(err) = ObjCObject::keep_instance(global, receiver) {
                    return Reply {
                        value: returned(global, method, ret, false, Err(err)),
                        outs: Vec::new(),
                    };
                }
                (receiver, ObjCClass::wrap(global, class))
            }
            None => (JSValue::UNDEFINED, JSValue::UNDEFINED),
        };
        let call = JsCall {
            function,
            receiver,
            class,
            method,
            params,
            ret,
        };
        call_js(global, call, args)
    }

    fn report(err: bun_appkit::Error) {
        let global = VirtualMachine::get().global();
        let _ = bun_jsc::task::report_error_or_terminate(global, conv::throw(global, err));
    }
}

impl script::Methods for Handler {
    fn call(&self, call: Call<'_>) -> Reply {
        let (functions, pick) = match self {
            Handler::Class(link) => (link.functions(), Pick::Index(call.index)),
            Handler::Targets => (
                call.instance
                    .and_then(|data| data.downcast_ref::<JsInstance>())
                    .and_then(|instance| instance.link.functions()),
                Pick::Key(call.selector),
            ),
            Handler::Block(_) => (None, Pick::Itself),
        };
        self.answer(
            call.method,
            Some((call.receiver, call.class)),
            pick,
            functions,
            call.args,
            call.params,
            call.ret,
        )
    }

    fn report(&self, err: bun_appkit::Error) {
        Handler::report(err);
    }
}

impl block::BlockFn for Handler {
    fn call(&self, call: block::Call<'_>) -> Reply {
        let functions = match self {
            Handler::Block(link) => link.functions(),
            _ => None,
        };
        self.answer(
            call.method,
            None,
            Pick::Itself,
            functions,
            call.args,
            call.params,
            call.ret,
        )
    }

    fn report(&self, err: bun_appkit::Error) {
        Handler::report(err);
    }
}

/// A heap block of type `types` whose body is `function`, as its wrapper:
/// the block keeps the function for as long as anything holds the block.
pub(super) fn block_wrapper(
    global: &JSGlobalObject,
    function: JSValue,
    types: &str,
) -> bun_appkit::Result<JSValue> {
    let link = Link::new();
    let block = block::make(types, Box::new(Handler::Block(Rc::clone(&link))))?;
    let wrapper = ObjCObject::wrap(global, block);
    let keeper = ObjCObject::keep(global, wrapper, function)
        .expect("a new block is live and keeps nothing yet");
    link.bind(global, keeper);
    Ok(wrapper)
}

fn string_list(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<Vec<String>> {
    let mut out = Vec::new();
    if value.is_undefined_or_null() {
        return Ok(out);
    }
    let mut iter = value.array_iterator(global)?;
    while let Some(item) = iter.next()? {
        out.push(
            JsStr::new(global, item, format_args!("{what}"))?
                .to_utf8()
                .into_string(),
        );
    }
    Ok(out)
}

/// `objcSetHooks(dispatch, outs)`, once, from `src/js/bun/objc.ts`: see [`Hooks`].
#[bun_jsc::host_fn]
fn objc_set_hooks(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (dispatch, outs) = (frame.argument(0), frame.argument(1));
    if !dispatch.is_callable() || !outs.is_array() {
        return Err(global.throw_type_error(format_args!(
            "objcSetHooks: expected a function and an array"
        )));
    }
    // The hooks, the handle table and the script classes are this thread's,
    // and their values belong to the global that loaded the module. When the
    // thread's own global has been replaced (bun test --isolate) the module
    // loads again under the new one and takes them over: the old global is
    // done, so its wrappers are forgotten (each object gets a fresh one on
    // next sight), its hooks dropped, and every block, target and class it
    // made is cut from its functions (the collector may take them, and native
    // code that still calls one gets zero) — a named class the new load
    // defines again is bound to the new functions then. Any other second
    // global on the thread (a ShadowRealm) would mix its objects into a live
    // module's, so it is refused before it can change anything.
    let other = HOOKS.with_borrow(|slot| {
        slot.as_ref()
            .is_some_and(|hooks| !core::ptr::eq::<JSGlobalObject>(&raw const *hooks.global, global))
    });
    if other && !core::ptr::eq::<JSGlobalObject>(VirtualMachine::get().global(), global) {
        return Err(conv::throw(
            global,
            bun_appkit::Error::InvalidState(
                "bun:objc is loaded by this thread's main global object; another global object on the same thread (a ShadowRealm) cannot use it",
            ),
        ));
    }
    let old = HOOKS.with_borrow_mut(|slot| {
        slot.replace(ManuallyDrop::new(Hooks {
            global: GlobalRef::new(global),
            dispatch: Strong::create(dispatch, global),
            outs: Strong::create(outs, global),
        }))
    });
    if let Some(old) = old {
        drop(ManuallyDrop::into_inner(old));
        if other {
            cut_links();
            drop(UNDER_SEND.with(|(_, parked)| parked.take()));
            drop(HANDLES.with_borrow_mut(|handles| core::mem::take(&mut **handles)));
        }
    }
    Ok(JSValue::UNDEFINED)
}

/// A defined method's constant result as `bun:objc` lets it through: a
/// boolean, a number, a bigint or null.
fn constant_body(global: &JSGlobalObject, value: JSValue, selector: &str) -> JsResult<DynValue> {
    Ok(if value.is_undefined_or_null() {
        DynValue::Nil
    } else if value.is_boolean() {
        DynValue::Bool(value.as_boolean())
    } else if value.is_number() {
        let n = value.as_number();
        if n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER {
            DynValue::I64(n as i64)
        } else {
            DynValue::F64(n)
        }
    } else if let Some(big) = JSBigInt::from_js(value)
        && value.is_big_int_in_int64_range(i64::MIN, i64::MAX)
    {
        DynValue::I64(big.to_int64())
    } else if value.is_big_int() && value.is_big_int_in_uint64_range(0, u64::MAX) {
        DynValue::U64(value.to_uint64_no_truncate())
    } else {
        return Err(global.throw_invalid_arguments(format_args!(
            "objc.defineClass(): method {selector} must be a function or a constant (a boolean, a number or null)"
        )));
    })
}

const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;

/// `objcDefineClass(name, superclass, protocols, selectors, types, bodies,
/// classMethodCount)`: registers the class and returns it. `bun:objc` has
/// already shaped the arguments; `types[i]` is `undefined` where the
/// encoding is to be looked up, `bodies[i]` is the method's function or its
/// constant result, and the last `classMethodCount` of each are the class
/// methods.
#[bun_jsc::host_fn]
fn objc_define_class(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = match frame.argument(0) {
        n if n.is_undefined_or_null() => String::new(),
        n => JsStr::new(global, n, format_args!("objc.defineClass(): name"))?
            .to_utf8()
            .into_string(),
    };
    let superclass = frame.argument(1);
    let superclass = conv::objc_class(superclass)
        .map(ObjCClass::class)
        .or_else(|| conv::objc_object(superclass).and_then(|o| o.object.as_class()));
    let Some(superclass) = superclass else {
        return Err(global.throw_invalid_arguments(format_args!(
            "objc.defineClass(): superclass must be a class name or a class handle"
        )));
    };
    let protocols = string_list(global, frame.argument(2), "objc.defineClass(): protocols")?;
    let selectors = string_list(
        global,
        frame.argument(3),
        "objc.defineClass(): method names",
    )?;
    let (types, functions) = (frame.argument(4), frame.argument(5));
    let class_count = frame.argument(6);
    if !types.is_array() || !functions.is_array() || !class_count.is_number() {
        return Err(global.throw_type_error(format_args!("objcDefineClass: bad arguments")));
    }
    let instance_count = selectors
        .len()
        .saturating_sub(class_count.as_number() as usize);
    let mut methods = Vec::with_capacity(selectors.len());
    let mut bodies = Vec::with_capacity(selectors.len());
    for (i, selector) in selectors.into_iter().enumerate() {
        let types = match types.get_index(global, i as u32)? {
            t if t.is_undefined_or_null() => None,
            t => Some(
                JsStr::new(
                    global,
                    t,
                    format_args!("objc.defineClass(): types of {selector}"),
                )?
                .to_utf8()
                .into_string(),
            ),
        };
        let body = functions.get_index(global, i as u32)?;
        let constant = if body.is_callable() {
            bodies.push(body);
            None
        } else {
            Some(constant_body(global, body, &selector)?)
        };
        methods.push(MethodSpec {
            selector,
            types,
            constant,
        });
    }
    let class_methods = methods.split_off(instance_count);
    let spec = ClassSpec {
        name,
        superclass,
        protocols,
        methods,
        class_methods,
        instance_owned: false,
    };
    let functions = JSValue::create_array_from_slice(global, &bodies)?;
    let link = Link::new();
    let defined = conv::check(
        global,
        script::define_class(&spec, Box::new(Handler::Class(Rc::clone(&link)))),
    )?;
    let class = defined.class;
    let link = CLASS_LINKS.with_borrow_mut(|links| match defined.rebound {
        // The class keeps the handler, and so the link, of its first definition.
        true => links.get(&class.address()).cloned(),
        false if spec.name.is_empty() => Some(link),
        false => Some(Rc::clone(
            links.entry(class.address()).or_insert_with(|| link),
        )),
    });
    if let Some(link) = link {
        link.bind(global, ObjCKeeper::make(global, None, functions));
    }
    Ok(ObjCClass::wrap(global, class))
}

/// `objcBlock(fn, types)`: a block of that type encoding whose body is `fn`.
#[bun_jsc::host_fn]
fn objc_block(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (function, types) = (frame.argument(0), frame.argument(1));
    if !function.is_callable() {
        return Err(
            global.throw_type_error(format_args!("objc.block(fn, types): fn must be a function"))
        );
    }
    let types = JsStr::new(global, types, format_args!("objc.block(fn, types): types"))?.to_utf8();
    conv::check(global, block_wrapper(global, function, &types))
}

/// `objcTargetClass()`: the one class every thread's `objc.target()` makes
/// instances of, defined now if no thread has yet. Its `action:` runs, on
/// the thread that attached it, the function in the table [`objc_attach`]
/// gave the instance.
#[bun_jsc::host_fn]
fn objc_target_class(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let mut slot = TARGETS.lock();
    let class = match *slot {
        Some(class) => class,
        None => {
            let spec = ClassSpec {
                name: String::new(),
                superclass: conv::check(global, dynamic::lookup_class("NSObject"))?,
                protocols: Vec::new(),
                methods: vec![MethodSpec {
                    selector: "action:".into(),
                    types: Some("v@:@".into()),
                    constant: None,
                }],
                class_methods: Vec::new(),
                instance_owned: true,
            };
            let class = conv::check(
                global,
                script::define_class(&spec, Box::new(Handler::Targets)),
            )?
            .class;
            *slot.insert(class)
        }
    };
    drop(slot);
    Ok(ObjCClass::wrap(global, class))
}

/// `objcAttach(handle, table)`: the functions of one [`TARGETS`] instance,
/// by selector, kept by its wrapper from now on and run on this thread.
#[bun_jsc::host_fn]
fn objc_attach(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let wrapper = conv::through_proxy(frame.argument(0));
    let (Some(this), table) = (wrapper.as_class_ref::<ObjCObject>(), frame.argument(1)) else {
        return Err(global.throw_type_error(format_args!("objcAttach: expected an ObjCObject")));
    };
    if !table.is_object() {
        return Err(
            global.throw_type_error(format_args!("objcAttach: expected an object of functions"))
        );
    }
    let link = Link::new();
    conv::check(
        global,
        script::attach(
            this.object(),
            Box::new(JsInstance {
                link: Rc::clone(&link),
            }),
        ),
    )?;
    link.bind(global, ObjCObject::keep(global, wrapper, table)?);
    Ok(JSValue::UNDEFINED)
}

/// The receiver a wrapper (or its proxy) stands for; a TypeError for anything else.
fn with_receiver<R>(
    global: &JSGlobalObject,
    value: JSValue,
    what: &str,
    f: impl FnOnce(Receiver<'_>) -> bun_appkit::Result<R>,
) -> JsResult<R> {
    if let Some(o) = conv::objc_object(value) {
        return conv::check(global, f(Receiver::Object(&o.object)));
    }
    if let Some(c) = conv::objc_class(value) {
        return conv::check(global, f(Receiver::Class(&c.class)));
    }
    Err(global.throw_type_error(format_args!("{what}: expected an ObjCObject or ObjCClass")))
}

/// `objcResponds(handle, selector)`: `respondsToSelector:` without sending
/// anything to a proxy or an unsent `alloc`.
#[bun_jsc::host_fn]
fn objc_responds(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let sel = selector_arg(global, frame.argument(1), "objcResponds():")?;
    let responds = with_receiver(global, frame.argument(0), "objcResponds()", |r| {
        r.responds_to(&sel)
    })?;
    Ok(JSValue::js_boolean(responds))
}

/// `objcMethodNames(handle)`: the selectors the receiver's classes implement, for `ownKeys`.
#[bun_jsc::host_fn]
fn objc_method_names(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let names = with_receiver(global, frame.argument(0), "objcMethodNames()", |r| {
        r.method_names()
    })?;
    JSValue::create_array_from_iter(global, names.into_iter(), |name| {
        conv::str_to_js(global, &name)
    })
}

/// `objcIsBlock(handle)`: whether the object is a block.
#[bun_jsc::host_fn]
fn objc_is_block(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let is = match conv::objc_object(frame.argument(0)) {
        Some(o) => conv::check(global, Receiver::Object(&o.object).is_block())?,
        None => false,
    };
    Ok(JSValue::js_boolean(is))
}

/// `objcInvokeBlock(handle, ...args)`: calls the block with `args`, typed
/// by the signature it was compiled with.
#[bun_jsc::host_fn]
fn objc_invoke_block(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let Some(block) = conv::objc_object(frame.argument(0)) else {
        return Err(
            global.throw_type_error(format_args!("objcInvokeBlock: expected an ObjCObject"))
        );
    };
    release_finalized();
    let sig = conv::check(global, dynamic::block_signature(&block.object))?;
    let args = frame.arguments();
    send_as(
        global,
        Receiver::Object(&block.object),
        &sig,
        args.get(1..).unwrap_or_default(),
    )
}

/// `objcMsgSendSuper(receiver, class, selector, ...args)`: `selector` sent
/// to `receiver` as the superclass of `class` (the script-defined class
/// whose method is sending it) implements it.
#[bun_jsc::host_fn]
fn objc_msg_send_super(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    const WHAT: &str = "objc.super(object).method()";
    // A class object (inside a class method) is held as an object for this.
    let class_object;
    let object = match conv::objc_object(frame.argument(0)) {
        Some(receiver) => &receiver.object,
        None => match conv::objc_class(frame.argument(0)) {
            Some(class) => {
                class_object = class.class.to_object();
                &class_object
            }
            None => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{WHAT}: object must be an ObjCObject or ObjCClass"
                )));
            }
        },
    };
    let Some(class) = conv::objc_class(frame.argument(1)) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "{WHAT}: the class whose superclass answers must be an ObjCClass"
        )));
    };
    release_finalized();
    let class = class.class;
    let receiver = Receiver::Super(object, &class);
    let sel = selector_arg(global, frame.argument(2), WHAT)?;
    let sig = conv::check(global, dynamic::signature(receiver, &sel))?;
    let args = frame.arguments();
    let result = send_as(global, receiver, &sig, args.get(3..).unwrap_or_default())?;
    ObjCObject::consumed(frame.argument(0));
    if sig.family.returns_retained() {
        ObjCObject::keep_instance(global, result)?;
    }
    Ok(result)
}

/// One exported C function, found and typed by `objcFunction`; `call`
/// converts its arguments by that type, calls it, and converts the result.
#[bun_jsc::JsClass(no_constructor)]
pub struct ObjCFunction {
    function: dynamic::Function,
}

impl ObjCFunction {
    pub fn call(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        release_finalized();
        let sig = self.function.signature();
        let (mut values, _pinned) = arguments_as(global, sig, frame.arguments())?;
        let result = bridged(global, || self.function.call(&mut values))?;
        result_of(global, result, values)
    }

    /// See [`drop_later`]: its signature holds an `NSMethodSignature`.
    pub fn finalize(self: Box<Self>) {
        drop_later(self);
    }
}

/// `objcFunction(name, types, formatIndex, returnsRetained, retainedOuts)`:
/// the exported C function `name` as an [`ObjCFunction`] typed `types`
/// (return type then argument types), variadic after a format argument at
/// `formatIndex` when that is a number; `returnsRetained` (a boolean, or
/// undefined for the SDK's word) and `retainedOuts` (argument indexes, or
/// undefined) say who owns what it returns and stores.
#[bun_jsc::host_fn]
fn objc_function(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = JsStr::new(global, frame.argument(0), format_args!("objc.fn(): name"))?.to_utf8();
    let types = JsStr::new(global, frame.argument(1), format_args!("objc.fn(): types"))?.to_utf8();
    let format = match frame.argument(2) {
        f if f.is_number() => Some(f.as_number() as usize),
        _ => None,
    };
    let mut ownership = dynamic::Ownership::default();
    if frame.argument(3).is_boolean() {
        ownership.returns_retained = Some(frame.argument(3).as_boolean());
    }
    let outs = frame.argument(4);
    if outs.is_object() {
        let count = outs.get_length(global)?;
        for i in 0..count {
            let index = outs.get_index(global, i as u32)?;
            if index.is_number() {
                ownership.retained_outs.push(index.as_number() as usize);
            }
        }
    }
    let function = conv::check(global, dynamic::function(&name, &types, format, ownership))?;
    Ok(JsClass::to_js(ObjCFunction { function }, global))
}

/// `objcConstant(name, types)`: the exported global `name` read as `types`.
#[bun_jsc::host_fn]
fn objc_constant(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = JsStr::new(
        global,
        frame.argument(0),
        format_args!("objc.constant(): name"),
    )?;
    let types = JsStr::new(
        global,
        frame.argument(1),
        format_args!("objc.constant(): type"),
    )?;
    let value = conv::check(global, dynamic::constant(&name.to_utf8(), &types.to_utf8()))?;
    conv::dyn_to_js(global, value)
}

/// Adds the classes and functions above to the `createObjcBinding` object;
/// from here on Objective-C exceptions inside sends are errors, this thread
/// is one `bun_appkit` hands its blocks and instances back to, and its half
/// of the bridge is let go when the thread exits ([`retire`]).
pub(super) fn install(global: &JSGlobalObject, binding: JSValue) {
    dynamic::catch_exceptions_with(dynamic::CatchFrames {
        invocation: dynamic::Bun__NSInvocation__tryInvoke,
        call: dynamic::Bun__ffi__tryCall,
        probe: dynamic::Bun__objc__recognizesException,
    });
    let vm = global.bun_vm();
    if handoff::install(Box::new(VmHome(vm.handle()))) {
        vm.as_mut()
            .rare_data()
            .push_cleanup_hook(global, core::ptr::null_mut(), retire);
    }
    binding.put(global, b"ObjCObject", ObjCObject::get_constructor(global));
    binding.put(global, b"ObjCClass", ObjCClass::get_constructor(global));
    binding.put(
        global,
        b"ObjCSelector",
        ObjCSelector::get_constructor(global),
    );
    let functions: [(&str, bun_jsc::JSHostFn, u32); 16] = [
        ("objcLookupClass", __jsc_host_objc_lookup_class, 1),
        ("objcLookupProtocol", __jsc_host_objc_lookup_protocol, 1),
        ("objcJs", __jsc_host_objc_js, 1),
        ("objcNs", __jsc_host_objc_ns, 1),
        ("objcResponds", __jsc_host_objc_responds, 2),
        ("objcMethodNames", __jsc_host_objc_method_names, 1),
        ("objcConstant", __jsc_host_objc_constant, 2),
        ("objcIsBlock", __jsc_host_objc_is_block, 1),
        ("objcInvokeBlock", __jsc_host_objc_invoke_block, 1),
        ("objcSetHooks", __jsc_host_objc_set_hooks, 2),
        ("objcDefineClass", __jsc_host_objc_define_class, 7),
        ("objcMsgSendSuper", __jsc_host_objc_msg_send_super, 3),
        ("objcFunction", __jsc_host_objc_function, 3),
        ("objcTargetClass", __jsc_host_objc_target_class, 0),
        ("objcAttach", __jsc_host_objc_attach, 2),
        ("objcBlock", __jsc_host_objc_block, 2),
    ];
    for (name, host_fn, arity) in functions {
        binding.put(
            global,
            name,
            JSFunction::create(global, name, host_fn, arity, Default::default()),
        );
    }
}
