use core::cell::{Cell, OnceCell};
use core::fmt;
use core::num::NonZeroU32;
use core::ptr::NonNull;
use std::cell::UnsafeCell;
use std::rc::{Rc, Weak};

use bun_collections::LinearFifo;
use bun_core::{Output, Timespec};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue, JsClass as _, JsResult, Strong};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_ptr::RefPtr;
use bun_sema::util::SmallLocalVec;
use super::cells::{CellExt as _, StrongCell};
use super::jest::{Jest, FileId, FileColumns as _};
use crate::jsc_hooks::timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, OwnedTimer};
use crate::cli::test_command::CommandLineReporter;
use crate::generated_bindgen::bun_test::{
    Bun__BunTest__hook, Bun__TestScope__Describe2__bunTestCatch, Bun__TestScope__Describe2__bunTestThen,
};
use super::execution::TimespecExt as _;
use super::test_context::{self, Deferred};
use super::test_context_fixtures::TestFixtures;
use super::test_context_parameter::SharedContextParameter;

bun_core::declare_scope!(bun_test_group, hidden);
// Callers use `group_log!` / `group_begin!` / `group_end!` below.
/// Thin macro over `debug::group::begin()` so call sites stay `group_begin!()`.
macro_rules! group_begin {
    () => {
        $crate::test_runner::debug::group::begin()
    };
}
pub(crate) use group_begin;

/// `Strong::create` requires a `&JSGlobalObject`; recover it from the
/// per-thread VM so `ExecutionEntry::create` (which has no global in scope)
/// can box callbacks.
#[inline]
fn strong_create(value: JSValue) -> Strong {
    let global = VirtualMachine::get().global();
    Strong::create(value, global)
}

pub(crate) fn clone_active_strong() -> Option<BunTestPtr> {
    let runner = Jest::runner()?;
    runner.bun_test_root.clone_active_file()
}

pub(crate) use super::done_callback::DoneCallback;

pub(crate) mod js_fns {
    use super::*;
    use crate::generated_bindgen::scope_functions::{CallbackOrOptions, DescriptionOrCallback};

    #[derive(Clone, Copy)]
    pub(crate) enum Signature<'a> {
        ScopeFunctions(&'a ScopeFunctions::ScopeFunctions),
        Str(&'static [u8]),
    }
    impl<'a> fmt::Display for Signature<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Signature::ScopeFunctions(sf) => write!(f, "{}", sf),
                Signature::Str(s) => write!(f, "{}", bstr::BStr::new(s)),
            }
        }
    }

    /// Only requires the runner: hooks are legal in preload scripts (they attach
    /// to the root), so the preload check lives in `clone_active_strong`.
    fn get_test_root(
        global_this: &JSGlobalObject,
        signature: Signature<'_>,
    ) -> JsResult<&'static mut BunTestRoot> {
        // `Jest.runner` is a process-global that outlives every caller, so the
        // unbounded `&'static mut` is the honest model here.
        let Some(runner) = Jest::runner() else {
            if global_this.bun_vm().worker_ref().is_some()
                && jsc::virtual_machine::isBunTest.load(core::sync::atomic::Ordering::Relaxed)
            {
                return Err(global_this.throw(format_args!("Cannot use {} in a Worker.", signature)));
            }
            return Err(global_this.throw(format_args!(
                "Cannot use {} outside of the test runner. Run \"bun test\" to run tests.",
                signature
            )));
        };
        // The runner calls every registered callback on the main thread's VM.
        if global_this.bun_vm().worker_ref().is_some() {
            return Err(global_this.throw(format_args!("Cannot use {} in a Worker.", signature)));
        }
        Ok(&mut runner.bun_test_root)
    }

    pub(crate) fn clone_active_strong(
        global_this: &JSGlobalObject,
        signature: Signature<'_>,
    ) -> JsResult<BunTestPtr> {
        let bun_test_root = get_test_root(global_this, signature)?;
        if global_this.bun_vm().is_in_preload.get() {
            return Err(global_this.throw(format_args!(
                "Cannot use {} during preload.",
                signature
            )));
        }
        let Some(bun_test) = bun_test_root.clone_active_file() else {
            return Err(global_this.throw(format_args!(
                "Cannot use {} outside of a test file.",
                signature
            )));
        };
        Ok(bun_test)
    }

    /// Tags accepted by `generic_hook`. Superset of `DescribeScope::HookTag`
    /// (adds `OnTestFinished`).
    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
    pub enum GenericHookTag {
        #[strum(serialize = "beforeAll")]
        BeforeAll,
        #[strum(serialize = "beforeEach")]
        BeforeEach,
        #[strum(serialize = "afterEach")]
        AfterEach,
        #[strum(serialize = "afterAll")]
        AfterAll,
        #[strum(serialize = "aroundEach")]
        AroundEach,
        #[strum(serialize = "aroundAll")]
        AroundAll,
        #[strum(serialize = "onTestFinished")]
        OnTestFinished,
        #[strum(serialize = "onTestFailed")]
        OnTestFailed,
    }
    impl GenericHookTag {
        const fn as_hook_tag(self) -> Option<HookTag> {
            match self {
                Self::BeforeAll => Some(HookTag::BeforeAll),
                Self::BeforeEach => Some(HookTag::BeforeEach),
                Self::AfterEach => Some(HookTag::AfterEach),
                Self::AfterAll => Some(HookTag::AfterAll),
                Self::AroundEach => Some(HookTag::AroundEach),
                Self::AroundAll => Some(HookTag::AroundAll),
                Self::OnTestFinished | Self::OnTestFailed => None,
            }
        }
        /// Per-variant signature string: the tag name plus `"()"`.
        const fn sig(self) -> &'static [u8] {
            match self {
                Self::BeforeAll => b"beforeAll()",
                Self::BeforeEach => b"beforeEach()",
                Self::AfterEach => b"afterEach()",
                Self::AfterAll => b"afterAll()",
                Self::AroundEach => b"aroundEach()",
                Self::AroundAll => b"aroundAll()",
                Self::OnTestFinished => b"onTestFinished()",
                Self::OnTestFailed => b"onTestFailed()",
            }
        }
        const fn deferred(self) -> Option<Deferred> {
            match self {
                Self::OnTestFinished => Some(Deferred::OnTestFinished),
                Self::OnTestFailed => Some(Deferred::OnTestFailed),
                _ => None,
            }
        }
        const fn around(self) -> Option<Around> {
            match self {
                Self::AroundEach => Some(Around::Each),
                Self::AroundAll => Some(Around::All),
                _ => None,
            }
        }
    }

    #[optimize(size)]
    pub(crate) fn generic_hook_impl<'a>(
        tag: GenericHookTag,
        flavor: Flavor,
        global_this: &JSGlobalObject,
        this_value: JsLocal<'a>,
        first: DescriptionOrCallback<'a>,
        second: CallbackOrOptions<'a>,
        third: CallbackOrOptions<'a>,
    ) -> JsResult<()> {
        let _g = group_begin!();
        // Run the body in a closure so every error exit funnels through the
        // log below before the group guard closes.
        let result = (|| -> JsResult<()> {

            let tag_name: &'static str = tag.into();
            let sig_bytes: &'static [u8] = tag.sig();

            let mut args = ScopeFunctions::parse_arguments(
                global_this,
                (first, JsLocal::UNDEFINED),
                second,
                third,
                Signature::Str(sig_bytes),
                ScopeFunctions::ParseArgumentsCfg {
                    callback: ScopeFunctions::CallbackMode::Require,
                    kind: match flavor {
                        Flavor::Jest => ScopeFunctions::FunctionKind::Hook,
                        Flavor::Vitest => ScopeFunctions::FunctionKind::VitestHook,
                    },
                    inherited: Default::default(),
                },
            )?;

            let calling = match (flavor, args.callback) {
                // An around hook's parameters are the same in every flavor.
                _ if tag.around().is_some() => Calling::Vitest { context: true },
                (Flavor::Vitest, _) => Calling::Vitest { context: true },
                (Flavor::Jest, Some(callback)) => Calling::Jest { done: callback.without_async_context().get_length(global_this)? > 0 },
                (Flavor::Jest, None) => Calling::default(),
            };
            // An extended `test` binds its `beforeAll` / `afterAll` / `aroundAll` with its `TestFixtures` as `this`.
            let mut fixtures = None;
            if let (Flavor::Vitest, GenericHookTag::BeforeAll | GenericHookTag::AfterAll, Some(callback))
            | (_, GenericHookTag::AroundAll, Some(callback)) = (flavor, tag, args.callback)
            {
                fixtures = Some(this_value.to_js()).filter(|&this| TestFixtures::from_js(this).is_some());
                let context_index = usize::from(tag.around().is_some());
                args.callback = Some(test_context::suite_hook(global_this, tag_name, callback, context_index, fixtures.is_some())?);
            }

            let bun_test_root = get_test_root(global_this, Signature::Str(sig_bytes))?;

            let cfg = ExecutionEntryCfg {
                calling,
                fixtures,
                timeout: args.options.timeout,
                around: tag.around().map(|around| (around, AroundPhase::SetUp)),
                ..Default::default()
            };

            let Some(bun_test) = bun_test_root.get_active_file_unless_in_preload(global_this.bun_vm()) else {
                if tag.deferred().is_some() {
                    return Err(global_this.throw(format_args!(
                        "Cannot call {}() in preload. It can only be called inside a test.",
                        tag_name
                    )));
                }
                bun_core::scoped_log!(bun_test_group, "genericHook in preload");

                let preload = bun_test_root.preload();
                preload.scope.append_hook(
                    &preload.entries,
                    tag.as_hook_tag().unwrap(),
                    args.callback,
                    cfg,
                    BaseScopeCfg::default(),
                    AddedInPhase::Preload,
                );
                return Ok(());
            };

            match bun_test.phase {
                Phase::Collection => {
                    if tag.deferred().is_some() {
                        return Err(global_this.throw(format_args!(
                            "Cannot call {}() outside of a test. It can only be called inside a test.",
                            tag_name
                        )));
                    }
                    if fixtures.is_some() {
                        bun_test.expect_file_scoped_fixtures();
                    }
                    bun_test.active_scope().append_hook(
                        &bun_test.entries,
                        tag.as_hook_tag().unwrap(),
                        args.callback,
                        cfg,
                        BaseScopeCfg::default(),
                        AddedInPhase::Collection,
                    );
                    Ok(())
                }
                Phase::Execution => {
                    // Vitest takes a file's hooks when it has collected the file, so one registered by a running test never runs.
                    if flavor == Flavor::Vitest && tag.deferred().is_none() {
                        return Ok(());
                    }
                    let active = bun_test.get_current_state_data();
                    let Some((sequence_ref, _)) = bun_test.execution.get_current_and_valid_execution_sequence(&active) else {
                        return Err(if tag.deferred().is_some() && flavor == Flavor::Vitest {
                            global_this.throw(format_args!(
                                "Cannot call {0}() inside a concurrent test. Use the one from the test context: test(name, ({{ {0} }}) => {{}})",
                                tag_name
                            ))
                        } else if tag == GenericHookTag::OnTestFinished {
                            global_this.throw(format_args!(
                                "Cannot call {}() here. It cannot be called inside a concurrent test. Use test.serial or remove test.concurrent.",
                                tag_name
                            ))
                        } else {
                            global_this.throw(format_args!(
                                "Cannot call {}() here. It cannot be called inside a concurrent test. Call it inside describe() instead.",
                                tag_name
                            ))
                        });
                    };

                    if let (Flavor::Vitest, Some(when), Some(callback)) = (flavor, tag.deferred(), args.callback) {
                        let (RefDataValue::Execution { group_index, entry_data: Some(entry_data) }, Some(strong)) =
                            (active, super::clone_active_strong())
                        else {
                            return Ok(());
                        };
                        if sequence_ref.test_entry.is_none() {
                            return Err(global_this.throw(format_args!(
                                "Cannot call {}() here. It can only be called inside a test.",
                                tag_name
                            )));
                        }
                        sequence_ref.context(global_this, &strong, group_index, entry_data.sequence_index);
                        sequence_ref.defer(bun_test, when, callback, cfg.timeout);
                        return Ok(());
                    }
                    let append_point: StepId = match tag {
                        GenericHookTag::AfterAll | GenericHookTag::AfterEach => {
                            let active_entry = sequence_ref.active_entry.get();
                            let test = bun_test.steps_from(active_entry).map(|(id, _)| id).find(|&id| Some(id) == sequence_ref.test_entry);
                            let Some(append_point) = test.or(active_entry) else {
                                return Err(global_this.throw(format_args!(
                                    "Cannot call {}() here. Call it inside describe() instead.",
                                    tag_name
                                )));
                            };
                            append_point
                        }
                        GenericHookTag::OnTestFinished => {
                            // Find the last entry in the sequence
                            let Some((last_entry, _)) = bun_test.steps_from(sequence_ref.active_entry.get()).last() else {
                                return Err(global_this.throw(format_args!(
                                    "Cannot call {}() here. Call it inside a test instead.",
                                    tag_name
                                )));
                            };
                            last_entry
                        }
                        _ => {
                            return Err(global_this.throw(format_args!(
                                "Cannot call {}() inside a test. Call it inside describe() instead.",
                                tag_name
                            )));
                        }
                    };

                    let new_item = bun_test.create_step(args.callback, cfg, AddedInPhase::Execution);
                    bun_test.link_after(append_point, new_item);

                    Ok(())
                }
                Phase::Done => Err(global_this.throw(format_args!(
                    "Cannot call {}() after the test run has completed",
                    tag_name
                ))),
            }
        })();
        if result.is_err() {
            crate::test_runner::debug::group::log("ended in error");
        }
        result
    }

    /// Indexed by discriminant.
    const TAGS: [GenericHookTag; 8] = [
        GenericHookTag::BeforeAll,
        GenericHookTag::BeforeEach,
        GenericHookTag::AfterEach,
        GenericHookTag::AfterAll,
        GenericHookTag::AroundEach,
        GenericHookTag::AroundAll,
        GenericHookTag::OnTestFinished,
        GenericHookTag::OnTestFailed,
    ];

    /// Every hook is `hook()` with its first argument bound. A separate native function per hook added 42 KB.
    pub(crate) fn create_hook(
        global_this: &JSGlobalObject,
        tag: GenericHookTag,
        flavor: Flavor,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            safe fn Bun__JSBoundFunction__setName(bound_function: JSValue, global: &JSGlobalObject, name: &bun_core::String);
        }
        let name: &'static str = tag.into();
        let name_string = bun_core::String::static_(name);
        let hook = jsc::JSFunction::create(global_this, name, Bun__BunTest__hook, 1, Default::default()).bind(
            global_this,
            this_value,
            &name_string,
            1.0,
            &[JSValue::js_number_from_int32(tag as i32 * 2 + flavor as i32)],
        )?;
        Bun__JSBoundFunction__setName(hook, global_this, &name_string);
        Ok(hook)
    }

    pub(crate) fn hook<'a>(
        cx: &mut JsScope<'a>,
        this_value: JsLocal<'a>,
        hook: u8,
        first: DescriptionOrCallback<'a>,
        second: CallbackOrOptions<'a>,
        third: CallbackOrOptions<'a>,
    ) -> JsResult<()> {
        let flavor = if hook.is_multiple_of(2) { Flavor::Jest } else { Flavor::Vitest };
        generic_hook_impl(TAGS[usize::from(hook / 2)], flavor, cx.global(), this_value, first, second, third)
    }
}

/// `Rc<BunTestCell>`: single-thread, weak-capable, interior-mutable shared handle.
///
/// Code mutates through this handle pervasively (re-entrantly via JS callbacks).
/// `Rc<T>` does **not** wrap `T` in `UnsafeCell`, so the previous
/// `Rc::as_ptr(&rc) as *mut T` + write was UB. The payload now lives in an
/// explicit `UnsafeCell` so all writes go through interior-mutable provenance.
pub(crate) type BunTestPtr = Rc<BunTestCell>;
pub(crate) type BunTestPtrWeak = Weak<BunTestCell>;
pub(crate) type BunTestPtrOptional = Option<Rc<BunTestCell>>;

/// `UnsafeCell` newtype so `Rc<BunTestCell>` permits mutation of the shared
/// `BunTest` (`UnsafeCell` is required for any write reachable through a
/// shared/`*const` path).
#[repr(transparent)]
pub(crate) struct BunTestCell(UnsafeCell<BunTest>);

impl BunTestCell {
    #[inline]
    pub(crate) fn new(bt: BunTest) -> Rc<Self> {
        Rc::new(Self(UnsafeCell::new(bt)))
    }

    /// Returns `&mut` because every call site mutates. The borrow is derived
    /// from `UnsafeCell::get()` so provenance is valid for writes even while
    /// other `Rc`/`Weak` handles exist.
    ///
    /// **Aliasing contract:** the test runner is single-threaded. Callers must not
    /// hold the returned `&mut` across a re-entrancy point (JS callback,
    /// `Collection::step`, `Execution::step`, `BunTest::run`) that itself calls
    /// `.get()` — re-derive afterwards instead. Prefer [`as_ptr`](Self::as_ptr)
    /// for long-lived handles that span re-entrant calls.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn get(&self) -> &mut BunTest {
        // SAFETY: `UnsafeCell` interior; single-threaded JS VM. See contract above.
        unsafe { &mut *self.0.get() }
    }

    /// Raw pointer for sites that must span re-entrant `.get()` calls without
    /// holding a live `&mut` (Stacked-Borrows-safe: raw ptrs do not assert
    /// uniqueness).
    #[inline]
    pub(crate) fn as_ptr(&self) -> *mut BunTest {
        self.0.get()
    }
}

impl core::ops::Deref for BunTestCell {
    type Target = BunTest;
    #[inline]
    fn deref(&self) -> &BunTest {
        // SAFETY: shared read through `UnsafeCell`; single-threaded — caller
        // must not hold a live `&mut` from `.get()` concurrently.
        unsafe { &*self.0.get() }
    }
}

/// Back-compat shim for sibling modules (jest.rs) that funneled through this
/// helper. Now routes through `UnsafeCell::get()` instead of the UB
/// `*const T as *mut T` cast.
///
/// # Safety
/// Caller must uphold the aliasing contract documented on [`BunTestCell::get`].
#[inline]
#[allow(clippy::mut_from_ref)] // interior mutability: routes through UnsafeCell::get()
pub(crate) unsafe fn buntest_as_mut(ptr: &BunTestPtr) -> &mut BunTest {
    ptr.get()
}

pub(crate) struct BunTestRoot {
    // gpa dropped — global mimalloc
    pub(crate) active_file: BunTestPtrOptional,
    preload: Cell<Option<Rc<Preload>>>,
    /// `RefData` pointers handed to `Promise.then()`. Tracked here (process-lifetime)
    /// so a never-settled promise's `+1` stays reachable; do not free orphans —
    /// a queued reaction may still consume them.
    pub(crate) pending_then_refs: std::cell::RefCell<Vec<*const RefData>>,
    /// Monotonic per-`enter_file` counter. Exposed to JS so per-file module
    /// state (node:test root) resets on `--rerun-each` where `Bun.main` is
    /// unchanged across iterations.
    pub(crate) file_generation: u32,
}

impl BunTestRoot {
    pub(crate) fn init() -> BunTestRoot {
        BunTestRoot {
            active_file: None,
            preload: Cell::new(None),
            pending_then_refs: std::cell::RefCell::new(Vec::new()),
            file_generation: 0,
        }
    }

    fn preload(&self) -> Rc<Preload> {
        self.preload.with_taken(|preload| Rc::clone(preload.get_or_insert_with(Preload::create)))
    }

    /// Drop preload-level hooks registered in the previous global. The next
    /// file's `loadPreloads()` re-registers them against the fresh global.
    pub(crate) fn reset_hook_scope_for_test_isolation(&self) {
        self.preload.set(None);
    }

    pub(crate) fn mark_timed_out(&self, group_index: usize, timed_out: EntryData) {
        for &pending in self.pending_then_refs.borrow().iter() {
            // SAFETY: the list owns a ref on each entry.
            let pending = unsafe { &*pending };
            if let RefDataValue::Execution {
                group_index: group,
                entry_data: Some(data),
            } = pending.phase
                && group == group_index
                && data == timed_out
            {
                pending.timed_out.set(true);
            }
        }
    }

    /// Tear down `bun:test` GC roots before `global_exit()` so
    /// `Zig__GlobalObject__destructOnExit()`'s `collectNow()` can reclaim the
    /// closures they pin. Releases the active file's per-test `Strong`s (the
    /// bail path skips its `scopeguard::defer! { exit_file() }` because
    /// `process::exit()` does not unwind), the preload-hook `Strong`s held in
    /// `preload`, and the `pending_then_refs` Vec.
    pub(crate) fn deinit_for_exit(&mut self) {
        if self.active_file.is_some() {
            self.exit_file();
        }
        self.reset_hook_scope_for_test_isolation();
        // `pending_then_refs` holds the `+1` `RefData` ref taken at
        // `Promise.then()` time so a never-settled promise's box stays
        // reachable. The corresponding deref happens in
        // `bun_test_then_or_catch` when the promise settles — which it now
        // never will (the VM is going away). Release each orphan ourselves;
        // any reaction that is still queued is dropped wholesale by
        // `Zig__GlobalObject__destructOnExit`.
        for ptr in self.pending_then_refs.borrow_mut().drain(..) {
            // SAFETY: `ptr` was produced by `RefPtr::into_raw` in
            // `BunTest::run_test_callback`; it is live because the promise
            // never settled (the settle path removes the entry before
            // releasing). Single-threaded.
            drop(unsafe { RefPtr::from_raw(ptr.cast_mut()) });
        }
    }

    pub(crate) fn enter_file(
        &mut self,
        file_id: FileId,
        reporter: &mut CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) {
        let _g = group_begin!();

        debug_assert!(self.active_file.is_none());
        self.file_generation = self.file_generation.wrapping_add(1);

        // Derive the stored backref from the TestRunner's *stable* storage
        // (the global `Jest::RUNNER` NonNull) rather than `self as *mut _`.
        // A pointer coerced from `&mut self` carries provenance bounded by this
        // call's reborrow; the next `Jest::runner()` hands out a fresh
        // an exclusive `&mut TestRunner`, invalidating that tag, so later derefs at
        // `BunTest::run`/`on_uncaught_exception` would be use-after-invalidation
        // under Stacked Borrows.
        // SAFETY: single-threaded; `RUNNER` outlives every BunTest. Field
        // projection via `addr_of_mut!` creates no intermediate `&mut TestRunner`,
        // and `addr_of_mut!` on a live struct field is never null.
        let stable_root: NonNull<BunTestRoot> = Jest::runner_ptr()
            .map(|p| unsafe { NonNull::new_unchecked(core::ptr::addr_of_mut!((*p.as_ptr()).bun_test_root)) })
            .unwrap_or_else(|| NonNull::from(&mut *self));

        // BunTest stores a backref to BunTestRoot, but the backref is the
        // `stable_root` raw pointer above (not an `Rc`), so plain construction
        // works without `Rc::new_cyclic`/two-phase init.
        // The reporter is the global `CommandLineReporter` owned by
        // `test_command::exec` which outlives every `BunTest`. `exit_file()`
        // nulls this before the file is dropped.
        let reporter_ptr = NonNull::from(&mut *reporter);
        let bun_test = BunTestCell::new(BunTest::init(
            stable_root,
            self.preload(),
            self.file_generation,
            file_id,
            Some(reporter_ptr),
            default_concurrent,
            first_last,
        ));
        self.active_file = Some(bun_test);
    }

    pub(crate) fn exit_file(&mut self) {
        let _g = group_begin!();

        debug_assert!(self.active_file.is_some());
        if let Some(active) = &self.active_file {
            // SAFETY: single-threaded; no other `&mut BunTest` is live during
            // teardown. Write goes through `UnsafeCell` (see `BunTestCell::get`).
            active.get().reporter = None;
        }
        self.active_file = None; // drops the Rc (deinit)
    }

    pub(crate) fn get_active_file_unless_in_preload(&mut self, vm: &VirtualMachine) -> Option<&mut BunTest> {
        if vm.is_in_preload.get() {
            return None;
        }
        // SAFETY: single-threaded; caller (js_fns::generic_hook) holds the only
        // live `&mut` for the duration of the hook-append below. Projection goes
        // through `UnsafeCell` (see `BunTestCell::get`).
        self.active_file.as_ref().map(|rc| rc.get())
    }

    pub(crate) fn clone_active_file(&self) -> Option<BunTestPtr> {
        self.active_file.clone()
    }

    pub(crate) fn on_before_print(&self) {
        if let Some(active_file) = &self.active_file {
            // Do NOT go through `<BunTestCell as Deref>` here. Two of the three
            // callers (`on_uncaught_exception`, test_command.rs report-status)
            // reach this while a `&mut BunTest` to the *same* cell payload is
            // live and reused afterward; materialising a sibling `&BunTest`
            // would pop the caller's Unique tag under Stacked Borrows. Read the
            // reporter field via raw ptr instead — `Option<NonNull<_>>` is `Copy`.
            // SAFETY: single-threaded; `active_file` keeps the cell alive; raw
            // field read creates no intermediate `&BunTest`.
            let reporter = unsafe { *core::ptr::addr_of!((*active_file.as_ptr()).reporter) };
            if let Some(reporter) = reporter {
                // SAFETY: reporter outlives every BunTest (owned by test_command::exec).
                // `last_printed_dot` is `Cell<bool>` so a `&` borrow suffices.
                let reporter = unsafe { reporter.as_ref() };
                if reporter.reporters.dots && reporter.last_printed_dot.get() {
                    bun_core::pretty_error!("<r>\n");
                    Output::flush();
                    reporter.last_printed_dot.set(false);
                }
                // `Jest::runner()` would hand out an exclusive `&mut TestRunner` while
                // `self: &BunTestRoot` — a field of that same TestRunner — is
                // live. Project `current_file` through the raw global ptr instead.
                if let Some(runner_ptr) = Jest::runner_ptr() {
                    // SAFETY: single-threaded; disjoint field from `bun_test_root`.
                    unsafe {
                        (*core::ptr::addr_of_mut!((*runner_ptr.as_ptr()).current_file)).print_if_needed();
                    }
                }
            }
        }
    }
}

impl Drop for BunTestRoot {
    fn drop(&mut self) {
        debug_assert!(self.active_file.is_none());
    }
}

/// Names a `DescribeScope` for `BunTest::scope`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct ScopeId(NonZeroU32);

impl ScopeId {
    /// The file's own scope.
    pub(crate) const ROOT: ScopeId = ScopeId(NonZeroU32::MIN);
    /// The parent of `ROOT`.
    const PRELOAD: ScopeId = ScopeId(NonZeroU32::MAX);
}

/// Names an `ExecutionEntry` for `BunTest::entry`.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct EntryId(NonZeroU32);

impl EntryId {
    const IN_PRELOAD: u32 = 1 << 31;
}

/// Names a `Step` for `BunTest::step`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct StepId(NonZeroU32);

/// The hooks that preload scripts register, which every file runs.
struct Preload {
    scope: DescribeScope,
    entries: SmallLocalVec<ExecutionEntry>,
}

impl Preload {
    fn create() -> Rc<Preload> {
        Rc::new(Preload {
            scope: DescribeScope::create(
                ScopeId::PRELOAD,
                BaseScope::init(BaseScopeCfg::default(), None, None, false),
                Default::default(),
            ),
            entries: SmallLocalVec::new(),
        })
    }
}

/// An entry's place in a sequence. A `beforeEach` hook has one for each test it runs before.
pub(crate) struct Step {
    pub(crate) entry: EntryId,
    pub(crate) next: Cell<Option<StepId>>,
    /// if this entry fails, go to the entry 'failure_skip_past.next'
    pub(crate) failure_skip_past: Cell<Option<StepId>>,
    /// '.epoch' = not set
    /// when this entry begins executing, the timespec will be set to the current time plus the timeout(ms).
    pub(crate) timespec: Cell<Timespec>,
}

/// See `BunTest::scopes_from`.
pub(crate) struct ScopeChain<'a> {
    buntest: &'a BunTest,
    next: Option<ScopeId>,
}

impl<'a> Iterator for ScopeChain<'a> {
    type Item = &'a DescribeScope;

    fn next(&mut self) -> Option<&'a DescribeScope> {
        let scope = self.buntest.scope(self.next?);
        self.next = scope.base.parent;
        Some(scope)
    }
}

#[derive(Copy, Clone)]
pub(crate) struct FirstLast {
    pub(crate) first: bool,
    pub(crate) last: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Phase {
    #[strum(serialize = "collection")]
    Collection,
    #[strum(serialize = "execution")]
    Execution,
    #[strum(serialize = "done")]
    Done,
}

pub(crate) struct BunTest {
    pub(crate) bun_test_root: bun_ptr::BackRef<BunTestRoot>,
    pub(crate) in_run_loop: bool,
    // gpa / arena_allocator / arena dropped — see §Allocators (non-AST crate)
    pub(crate) file_id: FileId,
    /// `BunTestRoot::file_generation` of this run of the file.
    pub(crate) generation: u32,
    /// null if the runner has moved on to the next file but a strong reference to BunTest is still keeping it alive
    ///
    /// Stored as
    /// `NonNull` (not `&`) so callbacks (`handle_test_completed`, junit writer,
    /// uncaught-exception handler) can write through it without deriving `&mut`
    /// from `&` (UB). The reporter is owned by `test_command::exec`'s stack
    /// frame, which never returns; `exit_file()` nulls this before drop.
    pub(crate) reporter: Option<NonNull<CommandLineReporter>>,
    pub(crate) timer: OwnedTimer,
    pub(crate) result_queue: ResultQueue,
    /// Whether tests in this file should default to concurrent execution
    pub(crate) default_concurrent: bool,
    pub(crate) first_last: FirstLast,
    preload: Rc<Preload>,
    scopes: SmallLocalVec<DescribeScope>,
    entries: SmallLocalVec<ExecutionEntry>,
    steps: SmallLocalVec<Step>,
    pub(crate) wants_wakeup: bool,
    /// The phase passed to the most recent `run_next_tick`.
    pending_phase: RefDataValue,
    /// Set while the global unhandled-error handler reports an error through `on_uncaught_exception`.
    pub(crate) is_reporting_uncaught: bool,
    /// True until `TestCommand::run` starts the runner, because the file's module may still be registering tests.
    pub(crate) is_loading: bool,
    /// Callback-less entry that runs last in the file. `defer_to_file_end` links its entries after it.
    file_end: OnceCell<StepId>,
    pub(crate) unclaimed: super::expect::expect_deferred::Unclaimed,

    pub(crate) phase: Phase,
    pub(crate) collection: Collection,
    pub(crate) execution: Execution::Execution,
}

bun_event_loop::impl_timer_owner!(BunTest; from_timer_ptr => timer);

impl BunTest {
    /// `bun_test_root` must point at the stable global `BunTestRoot` storage
    /// that outlives the returned `BunTest`.
    fn init(
        bun_test_root: NonNull<BunTestRoot>,
        preload: Rc<Preload>,
        generation: u32,
        file_id: FileId,
        reporter: Option<NonNull<CommandLineReporter>>,
        default_concurrent: bool,
        first_last: FirstLast,
    ) -> Self {
        let _g = group_begin!();

        let self_only = Jest::runner().is_some_and(|runner| runner.only);
        let root = BaseScope::init(BaseScopeCfg::default(), None, Some(&preload.scope), false);
        root.only.set(if self_only { Only::Contains } else { Only::No });
        let scopes = SmallLocalVec::new();
        scopes.push(DescribeScope::create(ScopeId::ROOT, root, Default::default()));

        BunTest {
            bun_test_root: bun_ptr::BackRef::from(bun_test_root),
            in_run_loop: false,
            phase: Phase::Collection,
            file_id,
            generation,
            collection: Collection::init(),
            execution: Execution::Execution::init(),
            reporter,
            result_queue: ResultQueue::init(),
            default_concurrent,
            first_last,
            preload,
            scopes,
            entries: SmallLocalVec::new(),
            steps: SmallLocalVec::new(),
            // `EventLoopTimer` has no `Default`; `init_paused` sets
            // `next = EPOCH, state = PENDING`.
            timer: OwnedTimer::init_paused(EventLoopTimerTag::BunTest),
            wants_wakeup: false,
            pending_phase: RefDataValue::Start,
            is_reporting_uncaught: false,
            is_loading: true,
            file_end: OnceCell::new(),
            unclaimed: Default::default(),
        }
    }

    pub(crate) fn scope(&self, id: ScopeId) -> &DescribeScope {
        if id == ScopeId::PRELOAD {
            return &self.preload.scope;
        }
        self.scopes.get(id.0.get() - 1)
    }

    pub(crate) fn entry(&self, id: EntryId) -> &ExecutionEntry {
        let entries = if id.0.get() & EntryId::IN_PRELOAD != 0 { &self.preload.entries } else { &self.entries };
        entries.get((id.0.get() - 1) & !EntryId::IN_PRELOAD)
    }

    pub(crate) fn step(&self, id: StepId) -> &Step {
        self.steps.get(id.0.get() - 1)
    }

    pub(crate) fn entry_of(&self, id: StepId) -> &ExecutionEntry {
        self.entry(self.step(id).entry)
    }

    /// `innermost` and the scopes around it, up to the unnamed scopes of the file and of the preload scripts.
    pub(crate) fn scopes_from(&self, innermost: Option<ScopeId>) -> ScopeChain<'_> {
        ScopeChain { buntest: self, next: innermost }
    }

    /// `first` and the steps that follow it.
    pub(crate) fn steps_from(&self, first: Option<StepId>) -> impl Iterator<Item = (StepId, &Step)> {
        let mut next = first;
        core::iter::from_fn(move || {
            let id = next?;
            let step = self.step(id);
            next = step.next.get();
            Some((id, step))
        })
    }

    pub(crate) fn active_scope(&self) -> &DescribeScope {
        self.scope(self.collection.active_scope.get())
    }

    pub(crate) fn push_step(&self, entry: EntryId) -> StepId {
        StepId(NonZeroU32::MIN.saturating_add(self.steps.push(Step {
            entry,
            next: Cell::new(None),
            failure_skip_past: Cell::new(None),
            timespec: Cell::new(Timespec::EPOCH),
        })))
    }

    /// A step for a new entry that is in no scope.
    pub(crate) fn create_step(&self, callback: Option<JSValue>, cfg: ExecutionEntryCfg, phase: AddedInPhase) -> StepId {
        let entry = ExecutionEntry::create(None, callback, cfg, None, None, BaseScopeCfg::default(), phase);
        self.push_step(entry.push_to(&self.entries))
    }

    fn link_after(&self, previous: StepId, step: StepId) {
        self.step(step).next.set(self.step(previous).next.replace(Some(step)));
    }

    fn propagate(&self, child: &BaseScope) {
        if child.only.get() != Only::No {
            // note that we overwrite '.yes' with '.contains' to support only-inside-only
            for scope in self.scopes_from(child.parent) {
                if scope.base.only.replace(Only::Contains) == Only::Contains {
                    break; // already marked
                }
            }
        }
        if child.has_callback.get() {
            for scope in self.scopes_from(child.parent) {
                if scope.base.has_callback.replace(true) {
                    break; // already marked
                }
            }
        }
    }

    /// Adds a child to the active scope.
    pub(crate) fn append_describe(
        &self,
        name_not_owned: Option<&[u8]>,
        base: BaseScopeCfg,
        inherited: ScopeFunctions::InheritedOptions,
    ) -> ScopeId {
        let parent = self.active_scope();
        let id = ScopeId(NonZeroU32::MIN.saturating_add(self.scopes.len()));
        let child = DescribeScope::create(id, BaseScope::init(base, name_not_owned, Some(parent), false), inherited);
        self.propagate(&child.base);
        self.scopes.push(child);
        parent.entries.with_taken(|entries| entries.push(TestScheduleEntry::Describe(id)));
        id
    }

    /// Adds a test to the active scope.
    pub(crate) fn append_test(
        &self,
        name_not_owned: Option<&[u8]>,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        parameter: Option<SharedContextParameter>,
        base: BaseScopeCfg,
    ) {
        let parent = self.active_scope();
        let entry =
            ExecutionEntry::create(name_not_owned, callback, cfg, parameter, Some(parent), base, AddedInPhase::Collection);
        entry.base.has_callback.set(entry.callback.is_some());
        self.propagate(&entry.base);
        let id = entry.push_to(&self.entries);
        parent.entries.with_taken(|entries| entries.push(TestScheduleEntry::TestCallback(id)));
    }

    /// Must be called before the order is generated, or `file_end` never runs.
    pub(crate) fn expect_file_scoped_fixtures(&self) {
        self.file_end.get_or_init(|| {
            let cfg = ExecutionEntryCfg { calling: Calling::Vitest { context: false }, ..Default::default() };
            self.create_step(None, cfg, AddedInPhase::Collection)
        });
    }

    pub(crate) fn defer_to_file_end(&self, callback: JSValue, timeout: u32) -> bool {
        let Some(&file_end) = self.file_end.get() else {
            return false;
        };
        // `file_end`'s group is always the last one.
        if self.phase != Phase::Execution || self.execution.group_index.get() + 1 >= self.execution.groups().len() {
            return false;
        }
        let entry = self.create_vitest_entry(callback, timeout);
        self.step(entry).failure_skip_past.set(Some(entry));
        self.link_after(file_end, entry);
        true
    }

    pub(crate) fn create_vitest_entry(&self, callback: JSValue, timeout: u32) -> StepId {
        let cfg = ExecutionEntryCfg { timeout, calling: Calling::Vitest { context: false }, ..Default::default() };
        self.create_step(Some(callback), cfg, AddedInPhase::Execution)
    }

    pub(crate) fn get_current_state_data(&self) -> RefDataValue {
        match self.phase {
            Phase::Collection => RefDataValue::Collection {
                active_scope: self.collection.active_scope.get(),
            },
            Phase::Execution => 'blk: {
                let Some(active_group) = self.execution.active_group() else {
                    // No group is active while `ExpectDeferred::step_file_end` waits after the last one.
                    break 'blk RefDataValue::Done;
                };
                let sequences = active_group.sequences(&self.execution);
                if sequences.len() != 1 {
                    break 'blk RefDataValue::Execution {
                        group_index: self.execution.group_index.get(),
                        entry_data: None, // the current execution entry is not known because we are running a concurrent test
                    };
                }

                let active_sequence_index = 0usize;
                let sequence = &sequences[active_sequence_index];

                let Some(active_entry) = sequence.active_entry.get() else {
                    break 'blk RefDataValue::Execution {
                        group_index: self.execution.group_index.get(),
                        entry_data: None, // the sequence is completed.
                    };
                };

                RefDataValue::Execution {
                    group_index: self.execution.group_index.get(),
                    entry_data: Some(EntryData {
                        sequence_index: active_sequence_index,
                        entry: Some(active_entry),
                        attempt: sequence.attempt.get(),
                    }),
                }
            }
            Phase::Done => RefDataValue::Done,
        }
    }

    pub(crate) fn ref_(this_strong: &BunTestPtr, phase: RefDataValue) -> RefPtr<RefData> {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "ref: {}", phase);

        RefPtr::new(RefData {
            buntest_weak: Rc::downgrade(this_strong),
            phase,
            timed_out: core::cell::Cell::new(false),
            ref_count: bun_ptr::RefCount::init(),
        })
    }

    fn bun_test_then_or_catch(
        global_this: &JSGlobalObject,
        result: JSValue,
        raw_ref: *mut RefData,
        is_catch: bool,
    ) -> JsResult<()> {
        let _g = group_begin!();

        // SAFETY: `raw_ref` was produced by `RefPtr::into_raw` in `run_test_callback`;
        // we adopt the +1 it carried.
        let refdata = unsafe { RefPtr::from_raw(raw_ref) };
        // Remove the pending_then_refs entry first so it never holds a freed `RefData`.
        if let Some(runner) = Jest::runner() {
            let mut pending = runner.bun_test_root.pending_then_refs.borrow_mut();
            if let Some(pos) = pending.iter().position(|p| *p == raw_ref.cast_const()) {
                pending.swap_remove(pos);
            }
        }
        let has_one_ref = refdata.has_one_ref();
        let Some(this_strong) = refdata.buntest_weak.upgrade() else {
            bun_core::scoped_log!(bun_test_group, "bunTestThenOrCatch -> the BunTest is no longer active");
            return Ok(());
        };
        // SAFETY: `&mut` derived via `UnsafeCell`; not held across `run_next_tick`
        // (which itself calls `.get()` for a single field write).
        let this = this_strong.get();

        if is_catch && !refdata.timed_out.get() {
            this.on_uncaught_exception(global_this, Some(result), true, &refdata.phase);
        }
        if !has_one_ref && !is_catch {
            bun_core::scoped_log!(bun_test_group, "bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref");
            return Ok(());
        }
        if !is_catch {
            this.adopt_teardown(&refdata.phase, result);
        }

        this.add_result(refdata.phase);
        // `this` borrow ends here (NLL); `run_next_tick` re-derives via `.get()`.
        Self::run_next_tick(&refdata.buntest_weak, global_this, refdata.phase);
        Ok(())
    }

    pub(crate) fn bun_test_then(
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
        context: *mut RefData,
    ) -> JsResult<()> {
        Self::bun_test_then_or_catch(cx.global(), value.to_js(), context, false)
    }

    pub(crate) fn bun_test_catch(
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
        context: *mut RefData,
    ) -> JsResult<()> {
        Self::bun_test_then_or_catch(cx.global(), value.to_js(), context, true)
    }

    fn on_done_error(global_this: &JSGlobalObject, done: &DoneCallback, error: JSValue) {
        if let Some(strong) = clone_active_strong() {
            let this = strong.get();
            let entry = &done.entry;
            let is_running_test = done
                .running_sequence(this)
                .is_some_and(|sequence| sequence.active_entry.get() == sequence.test_entry);
            if is_running_test {
                this.on_uncaught_exception(global_this, Some(error), false, entry);
                // As for any other uncaught exception: the test is over whatever its callback returns,
                // and `on_before_exit()` doesn't drain the event loop of a file that failed.
                this.add_result(*entry);
                Self::run_next_tick(&Rc::downgrade(&strong), global_this, *entry);
                global_this.bun_vm().unhandled_error_counter.update(|n| n + 1);
                return;
            }
        }
        let _ = global_this.bun_vm().uncaught_exception(global_this, error, false);
    }

    pub(crate) fn bun_test_done_callback(
        cx: &mut JsScope<'_>,
        this_value: JsLocal<'_>,
        error: JsLocal<'_>,
    ) -> JsResult<()> {
        let _g = group_begin!();

        let global_this = cx.global();
        let Some(this) = this_value.to_js().as_class_ref::<DoneCallback>() else {
            return Err(global_this.throw(format_args!("Expected callee to be DoneCallback")));
        };

        let value = error.to_js();

        let was_error = !value.is_empty_or_undefined_or_null();
        if this.called.get() {
            // in Bun 1.2.20, this is a no-op
            // in Jest, this is "Expected done to be called once, but it was called multiple times."
            // Vitest does not support done callbacks
        } else {
            // error is only reported for the first done() call
            if was_error {
                Self::on_done_error(global_this, this, value);
            }
        }
        this.called.set(true);
        let Some(ref_in) = this.r#ref.take() else {
            return Ok(());
        };

        // dupe the ref and enqueue a task to call the done callback.
        // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.

        let has_one_ref = ref_in.has_one_ref();
        let should_run = has_one_ref || was_error;

        if !should_run {
            return Ok(());
        }

        let Some(strong): Option<BunTestPtr> = ref_in.buntest_weak.upgrade() else {
            return Ok(());
        };
        // SAFETY: `&mut` derived via `UnsafeCell`; borrow ends before
        // `run_next_tick` re-derives.
        strong.get().add_result(ref_in.phase);
        Self::run_next_tick(&ref_in.buntest_weak, global_this, ref_in.phase);

        Ok(())
    }

    fn handle_timeout(&mut self, global_this: &JSGlobalObject) {
        let _g = group_begin!();
        self.kill_dangling_processes_on_timeout(global_this);
        self.add_result(RefDataValue::Start);
    }

    pub(crate) fn bun_test_timeout_callback(
        this_strong: &BunTestPtr,
        _ts: &Timespec,
        vm: &VirtualMachine,
    ) {
        let _g = group_begin!();
        let this: *mut BunTest = this_strong.as_ptr();
        let global = vm.global();
        // SAFETY: `this` derived from `UnsafeCell::get`; single-threaded; each
        // deref is a point-use that does not span a re-entrant `.get()`.
        unsafe {
            let timer = &(*this).timer;
            timer.next.set(Timespec::EPOCH);
            timer.state.set(EventLoopTimerState::PENDING);

            match (*this).phase {
                Phase::Collection => {}
                Phase::Execution => (*this).handle_timeout(global),
                Phase::Done => {}
            }
        }
        // Not run inline, because `Bun.spawnSync()` can fire this timer with the timed-out test still on the stack.
        Self::run_next_tick(&Rc::downgrade(this_strong), global, RefDataValue::Done);
    }

    pub(crate) fn run_next_tick(weak: &BunTestPtrWeak, global_this: &JSGlobalObject, phase: RefDataValue) {
        let vm = global_this.bun_vm();
        // Check liveness before allocating so the early return doesn't strand a Box.
        let Some(strong) = weak.upgrade() else {
            debug_assert!(false); // shouldn't be calling runNextTick after moving on to the next file
            return; // but just in case
        };
        let task = jsc::Task::from_boxed(Box::new(RunTestsTask {
            weak: Weak::clone(weak),
            global_this: GlobalRef::from(global_this),
            phase,
        }));
        // SAFETY: single field write through `UnsafeCell`; no other `&mut` live.
        strong.get().wants_wakeup = true;
        strong.get().pending_phase = phase;
        // The next microtask drain normally runs this. The task is a fallback for a drain that happens with JS on the stack.
        vm.has_pending_test_step.set(true);
        // we need to wake up the event loop so autoTick() doesn't wait for 16-100ms because we just enqueued a task
        vm.enqueue_task(task);
    }

    /// Runs the step queued by `run_next_tick` right away instead of waiting for its task.
    #[inline(never)] // --trim cuts the test runner at the call.
    pub(crate) fn run_pending_step(global_this: &JSGlobalObject) {
        let Some(strong) = clone_active_strong() else {
            return;
        };
        let phase = strong.get().pending_phase;
        // After a termination the exception is still pending, and the caller's next drain reports it.
        let _ = Box::new(RunTestsTask {
            weak: Rc::downgrade(&strong),
            global_this: GlobalRef::from(global_this),
            phase,
        })
        .call();
    }

    pub(crate) fn add_result(&mut self, result: RefDataValue) {
        let _ = self.result_queue.write_item(result); // OOM/capacity: fire-and-forget
    }

    pub(crate) fn run(this_strong: &BunTestPtr, global_this: &JSGlobalObject) -> JsResult<()> {
        let _g = group_begin!();
        // `Collection::step` / `Execution::step` re-enter and call `.get()` on
        // the same `Rc`, so we keep a raw `*mut` (via `UnsafeCell`) and reborrow
        // per-use instead of holding one long-lived `&mut` that would alias.
        let this: *mut BunTest = this_strong.as_ptr();

        // SAFETY: `this` is `UnsafeCell::get()`-derived; single-threaded JS VM;
        // each `(*this)` deref below is a short-lived reborrow that does not
        // span a re-entrant `.get()` call.
        unsafe {
            if (*this).in_run_loop {
                return Ok(());
            }
            (*this).in_run_loop = true;
        }
        // The guard captures the raw ptr
        // (not a `&mut bool`) so no `&mut` is held across the loop body.
        let _reset = scopeguard::guard(this, |p| {
            // SAFETY: `p` is the same `UnsafeCell`-derived ptr; `this_strong`
            // keeps the allocation alive for the whole function.
            unsafe { (*p).in_run_loop = false }
        });

        let mut min_timeout = Timespec::EPOCH;

        // SAFETY: see block-SAFETY above. `step()` may call `.get()` internally;
        // no outer `&mut` overlaps because we only touch `*this` between calls.
        while let Some(result) = unsafe { (*this).result_queue.read_item() } {
            global_this.clear_termination_exception();
            // SAFETY: `UnsafeCell`-derived `*mut`; short-lived field read between re-entrant calls.
            let step_result: StepResult = match unsafe { (*this).phase } {
                Phase::Collection => Collection::step(this_strong, global_this, &result)?,
                Phase::Execution => Execution::Execution::step(this_strong, global_this, &result)?,
                Phase::Done => StepResult::Complete,
            };
            match step_result {
                StepResult::Waiting { timeout } => {
                    min_timeout = min_timeout.min_ignore_epoch(timeout);
                }
                StepResult::Complete => {
                    // SAFETY: short-lived reborrow; `advance` does not re-enter `.get()`.
                    if unsafe { (*this).advance(global_this)? } == Advance::Exit {
                        return Ok(());
                    }
                    // SAFETY: `UnsafeCell`-derived `*mut`; sole `&mut` for this enqueue.
                    unsafe { (*this).add_result(RefDataValue::Start) };
                }
            }
        }

        Self::update_min_timeout(this_strong, &min_timeout);
        Ok(())
    }

    fn update_min_timeout(this: &BunTestPtr, min_timeout: &Timespec) {
        let _g = group_begin!();
        // SAFETY: neither caller holds a `&mut BunTest`.
        let timer: &EventLoopTimer = unsafe { &(*this.as_ptr()).timer };
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        bun_core::scoped_log!(
            bun_test_group,
            "-> timeout: {:?} {}.{}, {:?}",
            min_timeout,
            timer.next.get().sec,
            timer.next.get().nsec,
            Timespec::order_ignore_epoch(*min_timeout, timer.next.get())
        );
        if Timespec::order_ignore_epoch(*min_timeout, timer.next.get()) == core::cmp::Ordering::Less {
            bun_core::scoped_log!(bun_test_group, "-> setting timer to {:?}", min_timeout);
            if timer.next.get() != Timespec::EPOCH {
                bun_core::scoped_log!(bun_test_group, "-> removing existing timer");
                timer_all().remove(timer);
            }
            timer.next.set(*min_timeout);
            if timer.next.get() != Timespec::EPOCH {
                bun_core::scoped_log!(bun_test_group, "-> inserting timer");
                timer_all().insert(timer);
                if debug::group::get_log_enabled() {
                    let duration = min_timeout.since_now_force_real_time();
                    bun_core::scoped_log!(bun_test_group, "-> timer duration: {}", duration);
                }
            }
            bun_core::scoped_log!(bun_test_group, "-> timer set");
        }
    }

    fn advance(&mut self, _global_this: &JSGlobalObject) -> JsResult<Advance> {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "advance from {}", <&'static str>::from(self.phase));
        let result = self.advance_inner();
        bun_core::scoped_log!(bun_test_group, "advance -> {}", <&'static str>::from(self.phase));
        result
    }

    fn advance_inner(&mut self) -> JsResult<Advance> {
        match self.phase {
            Phase::Collection => {
                self.phase = Phase::Execution;
                debug::dump_describe(self, self.scope(ScopeId::ROOT))?;

                let has_filter = if let Some(reporter) = self.reporter {
                    // SAFETY: reporter outlives every BunTest (see field doc).
                    unsafe { reporter.as_ref() }.jest.filter_regex.is_some()
                } else {
                    false
                };
                // Derive a per-file shuffle seed from (seed, file_path) so a
                // file's test order depends only on the path and the printed
                // seed — not on which worker ran it or what files preceded it
                // on that worker. This is what makes --parallel --randomize
                // reproducible via --seed=N.
                let (randomize, seed) = if let Some(reporter) = self.reporter {
                    // SAFETY: reporter outlives every BunTest (see field doc).
                    let jest = &unsafe { reporter.as_ref() }.jest;
                    let path = jest.files.items_source()[self.file_id as usize].path.text;
                    // Basename only so the hash is platform-independent (path
                    // separators and absolute prefixes differ on Windows).
                    let seed = bun_wyhash::hash(bun_paths::basename(path))
                        .wrapping_add(u64::from(jest.test_options.seed.unwrap_or(0)));
                    (jest.test_options.randomize, seed)
                } else {
                    (false, 0)
                };

                let mut order = Order::Order::init(self, Order::Config {
                    always_use_hooks: self.scope(ScopeId::ROOT).base.only.get() == Only::No && !has_filter,
                    randomize: randomize.then(|| bun_core::rand::DefaultPrng::init(seed)),
                    seed,
                });

                let preload = self.preload.scope.hooks.take();
                if preload.before_all.iter().chain(&preload.after_all).chain(&preload.around_all).any(|&hook| self.entry(hook).fixtures.is_some()) {
                    self.expect_file_scoped_fixtures();
                }
                let aroundall_order: Order::AllOrderResult = if self.first_last.first {
                    order.generate_all_order(&preload.around_all, true)
                } else {
                    Order::AllOrderResult::EMPTY
                };
                let beforeall_order: Order::AllOrderResult = if self.first_last.first {
                    order.generate_all_order(&preload.before_all, true)
                } else {
                    Order::AllOrderResult::EMPTY
                };
                order.generate_order_describe(ScopeId::ROOT, &preload);
                beforeall_order.set_failure_skip_to(&mut order);
                let afterall_order: Order::AllOrderResult = if self.first_last.last {
                    order.generate_all_order(&preload.after_all, true)
                } else {
                    Order::AllOrderResult::EMPTY
                };
                afterall_order.set_failure_skip_to(&mut order);
                aroundall_order.set_failure_skip_to(&mut order);
                if self.first_last.last {
                    order.generate_all_order(&preload.around_all_teardown, true);
                }
                self.preload.scope.hooks.set(preload);
                if let Some(&file_end) = self.file_end.get() {
                    order.append_group_of(file_end);
                }

                if let (true, Some(reporter)) = (order.shuffled, self.reporter) {
                    // SAFETY: `BunTest.reporter` carries write provenance from `enter_file`'s `&mut`; no other borrow is live here.
                    unsafe { (*reporter.as_ptr()).jest.summary.shuffled += 1 };
                }
                self.execution.load_from_order(order);
                debug::dump_order(self)?;
                Ok(Advance::Cont)
            }
            Phase::Execution => {
                self.in_run_loop = false;
                self.phase = Phase::Done;
                Ok(Advance::Exit)
            }
            Phase::Done => Ok(Advance::Exit),
        }
    }

    /// if sync, the result is returned. if async, None is returned.
    #[optimize(size)]
    pub(crate) fn run_test_callback(
        this_strong: &BunTestPtr,
        global_this: &JSGlobalObject,
        cfg_callback: JSValue,
        cfg_args: &[JSValue],
        cfg_done_parameter: bool,
        cfg_data: RefDataValue,
        timeout: &Timespec,
    ) -> Option<RefDataValue> {
        let _g = group_begin!();
        // Raw `*mut` (via `UnsafeCell`) — the JS event-loop call below can
        // re-enter `bun_test_then_or_catch` / `bun_test_done_callback` /
        // `on_unhandled_rejection`, each of which `.get()`s the same `BunTest`.
        // Hold a raw ptr and reborrow per-use so no two `&mut` overlap.
        let this: *mut BunTest = this_strong.as_ptr();
        let vm = global_this.bun_vm();

        // Don't use Option<JSValue> to make it harder for the conservative stack
        // scanner to miss it.
        let mut done_arg: JSValue = JSValue::ZERO;
        let mut done_callback: JSValue = JSValue::ZERO;

        if cfg_done_parameter {
            bun_core::scoped_log!(bun_test_group, "callTestCallback -> appending done callback param: data {}", cfg_data);
            done_callback = DoneCallback::create_unbound(global_this, cfg_data, this_strong.generation);
            done_arg = match DoneCallback::bind(done_callback, global_this) {
                Ok(v) => v,
                Err(e) => {
                    // SAFETY: `UnsafeCell`-derived; sole `&mut` at this point.
                    unsafe { (*this).on_uncaught_exception(global_this, Some(global_this.take_exception(e)), false, &cfg_data) };
                    JSValue::ZERO // failed to bind done callback
                }
            };
        }

        // An exception left pending by earlier code would make this call fail, so report it first.
        if global_this.has_exception() {
            global_this.clear_termination_exception();
            // SAFETY: `UnsafeCell`-derived; sole `&mut` at this point.
            unsafe { (*this).on_uncaught_exception(global_this, global_this.try_take_exception(), false, &RefDataValue::Start) };
        }

        Self::update_min_timeout(this_strong, timeout);
        let args_slice: &[JSValue] = if !done_arg.is_empty() { core::slice::from_ref(&done_arg) } else { cfg_args };
        // SAFETY: `this_strong` keeps the cell alive and in place for the whole call.
        let on_stack = unsafe { OnStack::enter(&raw const (*this).execution.on_stack, &cfg_data) };
        let result: JSValue = match vm
            .event_loop()
            .run_callback_with_result_and_forcefully_drain_microtasks(
                vm.test_isolation_state.file_context.get(),
                cfg_callback,
                global_this,
                JSValue::UNDEFINED,
                args_slice,
                move || drop(on_stack),
            )
            .and_then(|returned| Self::promise_of_thenable(global_this, returned))
        {
            Ok(v) => v,
            Err(_) => {
                global_this.clear_termination_exception();
                // SAFETY: re-derive after JS callback returned; no outer `&mut` was held across it.
                unsafe { (*this).on_uncaught_exception(global_this, global_this.try_take_exception(), false, &cfg_data) };
                bun_core::scoped_log!(bun_test_group, "callTestCallback -> error");
                JSValue::ZERO
            }
        };

        done_callback.ensure_still_alive();

        // Drain unhandled promise rejections.
        loop {
            // Prevent the user's Promise rejection from going into the uncaught promise rejection queue.
            if !result.is_empty() {
                if let Some(promise) = result.as_promise() {
                    // SAFETY: `as_promise` returned a non-null GC-managed JSPromise.
                    unsafe {
                        if (*promise).status() == PromiseStatus::Rejected {
                            (*promise).set_handled();
                        }
                    }
                }
            }

            let prev_unhandled_count = vm.unhandled_error_counter.get();
            let _ = global_this.handle_rejected_promises();
            if vm.unhandled_error_counter.get() == prev_unhandled_count {
                break;
            }
        }

        // `dcb_ref` is a raw observer alias, NOT a
        // counted handle. The single +1 from `ref()` is owned by
        // `dcb_data.ref`; `dcb_ref` just remembers the address so the
        // pending-promise branch can `dupe()` it and the tail can branch on
        // "wait for done callback". Holding a second `RefPtr<RefData>` here would
        // over-count and the done-callback path would never observe
        // `has_one_ref()`.
        let mut dcb_ref: Option<NonNull<RefData>> = None;
        if !done_callback.is_empty() && !result.is_empty() {
            if let Some(dcb_data) = done_callback.as_class_ref::<DoneCallback>() {
                if dcb_data.called.get() {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    let r = Self::ref_(this_strong, cfg_data);
                    let alias = NonNull::new(r.as_ptr())
                        .expect("ref_() returns a freshly-boxed RefData");
                    // Move the sole +1 into the DoneCallback.
                    dcb_data.r#ref.set(Some(r));
                    dcb_ref = Some(alias);
                }
            } else {
                debug_assert!(false); // this should be unreachable, we create DoneCallback above
            }
        }

        if !result.is_empty() {
            if let Some(promise) = result.as_promise() {
                let _keep = bun_jsc::EnsureStillAlive(result); // because sometimes we use promise without result

                bun_core::scoped_log!(bun_test_group, "callTestCallback -> promise: data {}", cfg_data);

                // S012: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
                match bun_jsc::JSPromise::opaque_mut(promise).status() {
                    PromiseStatus::Pending => {
                        // not immediately resolved; register 'then' to handle the result when it becomes available
                        let this_ref: RefPtr<RefData> = if let Some(dcb_ref_value) = dcb_ref {
                            // SAFETY: `dcb_ref_value` aliases the live RefData
                            // owned by `dcb_data.r#ref` (set just above; GC
                            // roots `done_callback` for this frame). Bump the
                            // refcount 1→2.
                            unsafe { RefPtr::init_ref(dcb_ref_value.as_ptr()) }
                        } else {
                            Self::ref_(this_strong, cfg_data)
                        };
                        // Track the `+1` handed to `Promise.then()` in case the promise never settles.
                        let raw_ref: *mut RefData = RefPtr::into_raw(this_ref);
                        this_strong
                            .bun_test_root
                            .get()
                            .pending_then_refs
                            .borrow_mut()
                            .push(raw_ref.cast_const());
                        let _ = result.then(
                            global_this,
                            raw_ref,
                            Bun__TestScope__Describe2__bunTestThen,
                            Bun__TestScope__Describe2__bunTestCatch,
                        );
                        // TODO: properly propagate exception upwards
                        return None;
                    }
                    PromiseStatus::Fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        let value = bun_jsc::JSPromise::opaque_mut(promise).result(global_this.vm());
                        // SAFETY: as in the `Rejected` arm.
                        unsafe { (*this).adopt_teardown(&cfg_data, value) };
                        return Some(cfg_data);
                    }
                    PromiseStatus::Rejected => {
                        let value = bun_jsc::JSPromise::opaque_mut(promise).result(global_this.vm());
                        // SAFETY: re-derive via `UnsafeCell` after the JS/microtask
                        // drain above; sole `&mut` at this point.
                        unsafe { (*this).on_uncaught_exception(global_this, Some(value), true, &cfg_data) };

                        // We previously marked it as handled above.

                        return Some(cfg_data);
                    }
                }
            }
        }

        if dcb_ref.is_some() {
            // completed asynchronously
            bun_core::scoped_log!(bun_test_group, "callTestCallback -> wait for done callback");
            return None;
        }

        bun_core::scoped_log!(bun_test_group, "callTestCallback -> sync");
        if !result.is_empty() {
            // SAFETY: re-derived after the JS callback returned; sole `&mut` at this point.
            unsafe { (*this).adopt_teardown(&cfg_data, result) };
        }
        Some(cfg_data)
    }

    /// A promise that follows `returned` if it's a thenable other than a promise. Otherwise `returned`.
    fn promise_of_thenable(global_this: &JSGlobalObject, returned: JSValue) -> JsResult<JSValue> {
        if !returned.is_object() || returned.as_promise().is_some() {
            return Ok(returned);
        }
        // Reads `then` once. Only a value without a callable `then` fulfills the promise right away.
        let promise = bun_jsc::JSPromise::create(global_this);
        promise.resolve(global_this, returned)?;
        Ok(if promise.status() == PromiseStatus::Fulfilled { returned } else { promise.to_js() })
    }

    /// Vitest runs a function returned by `beforeEach` / `beforeAll` after the matching after-hooks.
    fn adopt_teardown(&self, data: &RefDataValue, returned: JSValue) {
        if !returned.is_callable() {
            return;
        }
        let Some((sequence, _)) = self.execution.get_current_and_valid_execution_sequence(data) else {
            return;
        };
        let Some(step) = sequence.active_entry.get() else {
            return;
        };
        let hook = self.entry_of(step);
        if !hook.calling.is_vitest() {
            return;
        }
        if sequence.test_entry.is_none() {
            if let (Some(slot), None) = (hook.teardown, hook.around) {
                self.entry(slot).callback.set(strong_create(returned));
            }
        } else if sequence.test_follows(self, step) {
            sequence.defer(self, Deferred::Teardown, returned, hook.timeout);
        }
    }

    /// The `aroundAll` hook `hook` called `runSuite()`.
    pub(crate) fn enter_around_all(&self, hook: &ExecutionEntry, tear_down: JSValue, async_context: JSValue) {
        if let (Some(slot), Some(scope)) = (hook.teardown, hook.base.parent) {
            self.entry(slot).callback.set(strong_create(tear_down));
            self.scope(scope).async_context.set(strong_create(async_context));
        }
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    #[optimize(size)]
    pub(crate) fn on_uncaught_exception(
        &mut self,
        global_this: &JSGlobalObject,
        exception: Option<JSValue>,
        is_rejection: bool,
        user_data: &RefDataValue,
    ) {
        let _g = group_begin!();

        let _ = is_rejection;

        let handle_status: HandleUncaughtExceptionResult = match self.phase {
            Phase::Collection => Collection::handle_uncaught_exception(self, user_data),
            Phase::Done => HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests,
            Phase::Execution => Execution::Execution::handle_uncaught_exception(self, user_data),
        };

        bun_core::scoped_log!(bun_test_group, "onUncaughtException -> {}", <&'static str>::from(handle_status));

        // The ended error just unwinds a test that's already over. Inside a running test it's still a normal failure.
        if handle_status == HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
            && exception.is_some_and(|exception| self.unclaimed.is_ended_error(exception))
        {
            return;
        }

        if let (Phase::Execution, Some(thrown)) = (self.phase, exception)
            && let Err(err) = Execution::Execution::record_error(self, global_this, user_data, thrown)
        {
            global_this.bun_vm().run_error_handler(global_this.take_exception(err), None);
        }

        if handle_status == HandleUncaughtExceptionResult::HideError {
            return; // do not print error, it was already consumed
        }
        let Some(exception) = exception else {
            return; // the exception should not be visible (eg m_terminationException)
        };

        let mut unhandled_failure: Option<crate::cli::test_command::TestFailure> = None;
        let failure_ctx: *mut core::ffi::c_void = 'ctx: {
            let Some(reporter) = self.reporter else {
                break 'ctx core::ptr::null_mut();
            };
            // SAFETY: `BunTest.reporter` carries write provenance from `enter_file`'s
            // `&mut`; single-threaded test runner, no other borrow live here.
            let reporter = unsafe { &mut *reporter.as_ptr() };
            if !reporter.jest.test_options.reporters.junit {
                core::ptr::null_mut()
            } else if handle_status == HandleUncaughtExceptionResult::ShowHandledError {
                match self
                    .execution
                    .get_current_and_valid_execution_sequence(user_data)
                {
                    // Points into `execution.sequences`, a boxed slice that lives until the file is done.
                    Some((sequence, _)) => sequence.failure.as_ptr().cast(),
                    None => core::ptr::null_mut(),
                }
            } else {
                core::ptr::from_mut(&mut unhandled_failure).cast()
            }
        };

        self.bun_test_root.on_before_print();
        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            // SAFETY: reporter is Some (asserted by call sites that reach here);
            // `NonNull<CommandLineReporter>` carries write provenance from
            // `enter_file`'s `&mut`; single-threaded, no other borrow live.
            unsafe {
                (*self.reporter.unwrap().as_ptr()).jest.unhandled_errors_between_tests += 1;
            }
            bun_core::pretty_errorln!(
                "<r>\n<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>\n<d>-------------------------------<r>\n",
            );
            Output::flush();
        }

        let vm = global_this.bun_vm();
        if !failure_ctx.is_null() {
            vm.on_print_error_zig_exception.set(Some(crate::cli::test_command::TestFailure::record_cb));
            vm.on_print_error_zig_exception_ctx.set(failure_ctx);
        }
        print_error(vm, global_this, exception, None);
        if !failure_ctx.is_null() {
            vm.on_print_error_zig_exception.set(None);
            vm.on_print_error_zig_exception_ctx.set(core::ptr::null_mut());
            // SAFETY: `failure_ctx` is one of the two `Option<TestFailure>` above, and the callback is done with it.
            let slot: &mut Option<crate::cli::test_command::TestFailure> =
                unsafe { &mut *failure_ctx.cast() };
            crate::cli::test_command::TestFailure::record_log_message(slot, exception);
            if let Some(failure) = slot
                && handle_status == HandleUncaughtExceptionResult::ShowHandledError
            {
                failure.uncaught |= self.is_reporting_uncaught;
            }
        }
        if let (Some(failure), Some(reporter)) = (unhandled_failure, self.reporter) {
            // SAFETY: as above.
            unsafe { &mut *reporter.as_ptr() }.record_unhandled_error(self.file_id, failure);
        }

        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            bun_core::pretty_error!("<r><d>-------------------------------<r>\n\n");
        }

        Output::flush();
    }
}

struct OnStack {
    cell: *const core::cell::Cell<Option<EntryData>>,
    outer: Option<EntryData>,
}

impl OnStack {
    /// # Safety
    /// `cell` must outlive the returned guard.
    unsafe fn enter(cell: *const core::cell::Cell<Option<EntryData>>, data: &RefDataValue) -> OnStack {
        let entry = match *data {
            RefDataValue::Execution { entry_data, .. } => entry_data,
            _ => None,
        };
        // SAFETY: per fn contract.
        OnStack { cell, outer: unsafe { (*cell).replace(entry) } }
    }
}

impl Drop for OnStack {
    fn drop(&mut self) {
        // SAFETY: per `enter`'s contract.
        unsafe { (*self.cell).set(self.outer) };
    }
}

/// Prints `error`, then prints any exception the error's getters or `toString` threw during the print.
pub(crate) fn print_error(
    vm: &VirtualMachine,
    global_this: &JSGlobalObject,
    error: JSValue,
    exception_list: Option<&mut bun_jsc::virtual_machine::ExceptionList>,
) {
    vm.run_error_handler(error, exception_list);
    // `BunTest::run` and `run_test_callback` clear termination exceptions.
    if global_this.has_pending_termination_exception() {
        return;
    }
    let Some(left) = global_this.try_take_exception() else {
        return;
    };
    vm.run_error_handler(left, None);
    // Printing this one could throw again, so just print a note.
    if !global_this.has_pending_termination_exception() && global_this.try_take_exception().is_some() {
        bun_core::pretty_errorln!("<blue>note<r><d>:<r> printing the error above threw another error");
        Output::flush();
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct EntryData {
    pub(crate) sequence_index: usize,
    pub(crate) entry: Option<StepId>,
    pub(crate) attempt: u32,
}

/// Only means something to the `BunTest` it was made for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RefDataValue {
    Start,
    Collection {
        active_scope: ScopeId,
    },
    Execution {
        group_index: usize,
        entry_data: Option<EntryData>,
    },
    Done,
}

impl RefDataValue {
    pub(crate) fn sequence<'a>(&self, buntest: &'a BunTest) -> Option<&'a Execution::ExecutionSequence> {
        let RefDataValue::Execution { group_index, entry_data } = self else { return None };
        let entry_data = (*entry_data)?;
        let group = buntest.execution.groups().get(*group_index)?;
        Some(&group.sequences(&buntest.execution)[entry_data.sequence_index])
    }

    pub(crate) fn entry(&self, buntest: &BunTest) -> Option<StepId> {
        if !matches!(self, RefDataValue::Execution { .. }) {
            return None;
        }
        if buntest.phase != Phase::Execution {
            return None;
        }
        let (the_sequence, _) = buntest.execution.get_current_and_valid_execution_sequence(self)?;
        the_sequence.active_entry.get()
    }
}

impl fmt::Display for RefDataValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RefDataValue::Start => write!(f, "start"),
            RefDataValue::Collection { active_scope } => write!(f, "collection: active_scope={}", active_scope.0),
            RefDataValue::Execution { group_index, entry_data } => {
                if let Some(ed) = entry_data {
                    write!(
                        f,
                        "execution: group_index={},sequence_index={},entry_index={},attempt={}",
                        group_index, ed.sequence_index, ed.entry.map_or(0, |entry| entry.0.get()), ed.attempt
                    )
                } else {
                    write!(f, "execution: group_index={}", group_index)
                }
            }
            RefDataValue::Done => write!(f, "done"),
        }
    }
}

// Intrusive single-thread refcount.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct RefData {
    pub(crate) buntest_weak: BunTestPtrWeak,
    pub(crate) phase: RefDataValue,
    /// The callback ran into its time limit. As in Vitest and Jest, a later rejection of its promise isn't an error.
    pub(crate) timed_out: core::cell::Cell<bool>,
    pub(crate) ref_count: bun_ptr::RefCount<RefData>,
}
impl Drop for RefData {
    fn drop(&mut self) {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "refData: {}", self.phase);
    }
}
impl RefData {
    pub(crate) fn has_one_ref(&self) -> bool {
        self.ref_count.has_one_ref()
    }
    pub(crate) fn bun_test(&self) -> Option<BunTestPtr> {
        self.buntest_weak.upgrade()
    }
}

pub(crate) struct RunTestsTask {
    pub(crate) weak: BunTestPtrWeak,
    // `GlobalRef` (not a borrow): the JSGlobalObject is stored across the task
    // tick, and the VM keeps it alive until shutdown.
    pub global_this: GlobalRef,
    pub(crate) phase: RefDataValue,
}
impl RunTestsTask {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn call(self: Box<Self>) -> JsResult<()> {
        let this = self;
        // Box drops at end of scope; the Weak drops with it.
        let Some(strong) = this.weak.upgrade() else { return Ok(()) };
        // Never run tests under JS or while the file loads. `TestCommand::run` drains the queue later.
        if this.global_this.vm().is_entered() || strong.get().is_loading {
            return Ok(());
        }
        if let Err(e) = BunTest::run(&strong, &this.global_this) {
            // A termination is the tick's to fold, not a test failure.
            if this.global_this.has_pending_termination_exception() {
                return Err(e);
            }
            // SAFETY: `&mut` derived via `UnsafeCell` after `run` returned; sole
            // borrow at this point.
            let bt = strong.get();
            bt.on_uncaught_exception(
                &this.global_this,
                Some(this.global_this.take_exception(e)),
                false,
                &this.phase,
            );
        }
        Ok(())
    }
}

impl bun_event_loop::BoxedTask for RunTestsTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::RunTestsTask;
    fn release_unrun(self: Box<Self>) {}
    /// Enters no context.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum HandleUncaughtExceptionResult {
    #[strum(serialize = "hide_error")]
    HideError,
    #[strum(serialize = "show_handled_error")]
    ShowHandledError,
    #[strum(serialize = "show_unhandled_error_between_tests")]
    ShowUnhandledErrorBetweenTests,
    #[strum(serialize = "show_unhandled_error_in_describe")]
    ShowUnhandledErrorInDescribe,
}

pub(crate) type ResultQueue = LinearFifo<RefDataValue, bun_collections::linear_fifo::DynamicBuffer<RefDataValue>>;
// bun.LinearFifo(.Dynamic) → second generic is the buffer strategy.

pub(crate) enum StepResult {
    Waiting { timeout: Timespec },
    Complete,
}
impl Default for StepResult {
    fn default() -> Self {
        StepResult::Waiting { timeout: Timespec::EPOCH }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Advance {
    Cont,
    Exit,
}

pub(crate) use super::collection::Collection;

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub(crate) enum ConcurrentMode {
    #[default]
    Inherit,
    No,
    Yes,
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub(crate) enum Flavor {
    /// "bun:test", "@jest/globals"
    #[default]
    Jest,
    Vitest,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Calling {
    Jest { done: bool },
    Vitest { context: bool },
}
impl Default for Calling {
    fn default() -> Self {
        Calling::Jest { done: false }
    }
}
impl Calling {
    pub(crate) fn is_vitest(self) -> bool {
        matches!(self, Calling::Vitest { .. })
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Around {
    Each,
    All,
}

/// An around hook runs in two entries. See `AroundHook`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum AroundPhase {
    /// Until the hook calls `runTest()` or `runSuite()`.
    SetUp,
    /// After the promise that call returned has resolved.
    TearDown,
}

#[derive(Copy, Clone, Default)]
pub(crate) struct BaseScopeCfg {
    pub(crate) flavor: Flavor,
    pub(crate) self_concurrent: ConcurrentMode,
    pub(crate) self_mode: ScopeMode,
    pub(crate) self_only: bool,
    pub(crate) self_shuffle: bool,
    pub(crate) test_id_for_debugger: i32,
    pub(crate) line_no: u32,
}
impl BaseScopeCfg {
    /// returns None if the other already has the value
    pub(crate) fn extend(self, other: BaseScopeCfg) -> Option<BaseScopeCfg> {
        let mut result = self;
        if other.self_concurrent != ConcurrentMode::Inherit {
            if result.self_concurrent != ConcurrentMode::Inherit {
                return None;
            }
            result.self_concurrent = other.self_concurrent;
        }
        if other.self_mode != ScopeMode::Normal {
            if result.self_mode != ScopeMode::Normal {
                return None;
            }
            result.self_mode = other.self_mode;
        }
        if other.self_only {
            if result.self_only {
                return None;
            }
            result.self_only = true;
        }
        result.self_shuffle |= other.self_shuffle;
        Some(result)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub(crate) enum ScopeMode {
    #[default]
    Normal,
    Skip,
    Todo,
    /// Jest's `test.failing`, which passes only if the test callback itself throws.
    Failing,
    /// Vitest's `test.fails`. See `ExecutionSequence::flip_fails`.
    Fails,
    FilteredOut,
}

impl ScopeMode {
    /// Lowercase variant name (e.g. "skip", "filtered_out") for labels/diagnostics.
    pub(crate) fn tag_name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Skip => "skip",
            Self::Todo => "todo",
            Self::Failing => "failing",
            Self::Fails => "fails",
            Self::FilteredOut => "filtered_out",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Only {
    No,
    Contains,
    Yes,
}

impl Only {
    /// Lowercase variant name (e.g. "yes", "contains") for labels/diagnostics.
    pub(crate) fn tag_name(self) -> &'static str {
        match self {
            Self::No => "no",
            Self::Contains => "contains",
            Self::Yes => "yes",
        }
    }
}

pub(crate) struct BaseScope {
    pub(crate) parent: Option<ScopeId>,
    pub name: Option<Box<[u8]>>,
    pub(crate) concurrent: bool,
    pub(crate) mode: ScopeMode,
    pub(crate) only: Cell<Only>,
    pub(crate) has_callback: Cell<bool>,
    /// this value is 0 unless the debugger is active and the scope has a debugger id
    pub(crate) test_id_for_debugger: Cell<i32>,
    /// only available if using junit reporter, otherwise 0
    pub(crate) line_no: u32,
}
impl BaseScope {
    fn init(
        cfg: BaseScopeCfg,
        name_not_owned: Option<&[u8]>,
        parent: Option<&DescribeScope>,
        has_callback: bool,
    ) -> BaseScope {
        let parent_base = parent.map(|p| &p.base);
        BaseScope {
            name: name_not_owned.map(Box::<[u8]>::from),
            concurrent: match cfg.self_concurrent {
                ConcurrentMode::Yes => true,
                ConcurrentMode::No => false,
                ConcurrentMode::Inherit => parent_base.is_some_and(|p| p.concurrent),
            },
            mode: if let Some(p) = parent_base {
                if p.mode != ScopeMode::Normal { p.mode } else { cfg.self_mode }
            } else {
                cfg.self_mode
            },
            only: Cell::new(if cfg.self_only { Only::Yes } else { Only::No }),
            has_callback: Cell::new(has_callback),
            test_id_for_debugger: Cell::new(cfg.test_id_for_debugger),
            line_no: cfg.line_no,
            parent: parent.map(|p| p.id),
        }
    }
}
// deinit: only frees `name` → Box<[u8]> drops automatically; no explicit Drop needed.

#[derive(Default)]
pub(crate) struct Hooks {
    pub(crate) before_all: Vec<EntryId>,
    pub(crate) before_each: Vec<EntryId>,
    pub(crate) after_each: Vec<EntryId>,
    /// Ends with the `teardown` slots of the Vitest hooks in `before_all`, in reverse order.
    pub(crate) after_all: Vec<EntryId>,
    teardown_slots_in_after_all: usize,
    pub(crate) around_each: Vec<EntryId>,
    pub(crate) around_all: Vec<EntryId>,
    /// The `teardown` slots of `around_all`, in reverse order.
    pub(crate) around_all_teardown: Vec<EntryId>,
}

impl Hooks {
    fn get_hook_entries(&mut self, tag: HookTag) -> &mut Vec<EntryId> {
        match tag {
            HookTag::BeforeAll => &mut self.before_all,
            HookTag::BeforeEach => &mut self.before_each,
            HookTag::AfterEach => &mut self.after_each,
            HookTag::AfterAll => &mut self.after_all,
            HookTag::AroundEach => &mut self.around_each,
            HookTag::AroundAll => &mut self.around_all,
        }
    }
}

pub(crate) struct DescribeScope {
    pub(crate) id: ScopeId,
    pub(crate) base: BaseScope,
    pub(crate) entries: Cell<Vec<TestScheduleEntry>>,
    /// `Order` consumes the hooks of a file's scopes.
    pub(crate) hooks: Cell<Hooks>,
    /// What `test_context_around::capture_async_context()` returned when an `around_all` hook last called `runSuite()`.
    pub(crate) async_context: StrongCell,

    /// if true, the describe callback threw an error. do not run any tests declared in this scope.
    pub(crate) failed: Cell<bool>,

    pub(crate) task: OnceCell<Strong>,
    pub(crate) inherited: ScopeFunctions::InheritedOptions,
}

impl DescribeScope {
    #[optimize(size)]
    fn create(id: ScopeId, base: BaseScope, inherited: ScopeFunctions::InheritedOptions) -> DescribeScope {
        DescribeScope {
            id,
            base,
            entries: Cell::default(),
            hooks: Cell::default(),
            async_context: StrongCell::default(),
            failed: Cell::new(false),
            task: OnceCell::new(),
            inherited,
        }
    }

    /// `entries` is the table of this scope's owner.
    fn append_hook(
        &self,
        entries: &SmallLocalVec<ExecutionEntry>,
        tag: HookTag,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) {
        let mut entry = ExecutionEntry::create(None, callback, cfg, None, Some(self), base, phase);
        // `create` drops the callback in a skipped scope, and a hook entry without one would be reported as a test.
        if !entry.callback.is_some() {
            return;
        }
        let is_vitest = cfg.calling.is_vitest();
        let create_slot = |around| {
            let slot_cfg = ExecutionEntryCfg {
                timeout: cfg.timeout,
                calling: Calling::Vitest { context: false },
                around,
                ..Default::default()
            };
            ExecutionEntry::create(None, None, slot_cfg, None, Some(self), base, phase).push_to(entries)
        };
        let mut hooks = self.hooks.take();
        let first_teardown_slot = hooks.after_all.len() - hooks.teardown_slots_in_after_all;
        match tag {
            HookTag::BeforeAll if is_vitest => {
                let slot = create_slot(None);
                hooks.after_all.insert(first_teardown_slot, slot);
                hooks.teardown_slots_in_after_all += 1;
                entry.teardown = Some(slot);
            }
            HookTag::AroundAll => {
                let slot = create_slot(Some((Around::All, AroundPhase::TearDown)));
                hooks.around_all_teardown.insert(0, slot);
                entry.teardown = Some(slot);
            }
            _ => {}
        }
        let entry = entry.push_to(entries);
        match tag {
            // Vitest runs a scope's after-hooks in reverse registration order.
            HookTag::AfterEach | HookTag::AfterAll if is_vitest => hooks.get_hook_entries(tag).insert(0, entry),
            HookTag::AfterAll => hooks.after_all.insert(first_teardown_slot, entry),
            _ => hooks.get_hook_entries(tag).push(entry),
        }
        self.hooks.set(hooks);
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum HookTag {
    BeforeAll,
    BeforeEach,
    AfterEach,
    AfterAll,
    AroundEach,
    AroundAll,
}

#[derive(Copy, Clone, Default)]
pub(crate) struct ExecutionEntryCfg {
    /// 0 = unlimited timeout
    pub(crate) timeout: u32,
    pub(crate) calling: Calling,
    pub(crate) around: Option<(Around, AroundPhase)>,
    pub(crate) fixtures: Option<JSValue>,
    /// Number of times to retry a failed test (0 = no retries)
    pub(crate) retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub(crate) repeat_count: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum AddedInPhase {
    Preload,
    Collection,
    Execution,
}

pub(crate) struct ExecutionEntry {
    pub(crate) base: BaseScope,
    pub(crate) callback: StrongCell,
    /// 0 = unlimited timeout
    pub(crate) timeout: u32,
    pub(crate) calling: Calling,
    pub(crate) around: Option<(Around, AroundPhase)>,
    pub(crate) fixtures: Option<Strong>,
    pub(crate) parameter: Option<SharedContextParameter>,
    pub(crate) added_in_phase: AddedInPhase,
    /// Number of times to retry a failed test (0 = no retries)
    pub(crate) retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub(crate) repeat_count: u32,
    /// An entry with no callback until this Vitest `beforeAll` returns a function, or this `aroundAll` calls `runSuite()`.
    teardown: Option<EntryId>,
}

impl ExecutionEntry {
    #[optimize(size)]
    fn create(
        name_not_owned: Option<&[u8]>,
        cb: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        parameter: Option<SharedContextParameter>,
        parent: Option<&DescribeScope>,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> ExecutionEntry {
        let base = BaseScope::init(base, name_not_owned, parent, cb.is_some());
        let callback = cb.filter(|_| match base.mode {
            ScopeMode::Skip => false,
            ScopeMode::Todo => Jest::runner().is_some_and(|runner| runner.run_todo),
            _ => true,
        });
        ExecutionEntry {
            base,
            callback: callback.map(strong_create).into(),
            timeout: cfg.timeout,
            calling: cfg.calling,
            around: cfg.around,
            fixtures: callback.and(cfg.fixtures).map(strong_create),
            parameter: parameter
                .or_else(|| (cfg.calling.is_vitest() && phase != AddedInPhase::Execution).then(Default::default)),
            added_in_phase: phase,
            retry_count: cfg.retry_count,
            repeat_count: cfg.repeat_count,
            teardown: None,
        }
    }

    fn push_to(self, entries: &SmallLocalVec<ExecutionEntry>) -> EntryId {
        let table = if self.added_in_phase == AddedInPhase::Preload { EntryId::IN_PRELOAD } else { 0 };
        EntryId(NonZeroU32::MIN.saturating_add(entries.push(self)) | table)
    }
}
// destroy → Drop: callback (Strong) and base.name (Box) drop automatically.

#[derive(Copy, Clone)]
pub(crate) enum TestScheduleEntry {
    Describe(ScopeId),
    TestCallback(EntryId),
}

// Module aliases so `Execution::ConcurrentGroup` / `Order::AllOrderResult`
// resolve as module paths without per-reference rewrites.
pub(crate) use super::execution as Execution;
pub(crate) use super::debug;
pub(crate) use super::scope_functions as ScopeFunctions;
pub(crate) use super::order as Order;

