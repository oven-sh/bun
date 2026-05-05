use core::fmt;
use std::cell::Cell;
use std::rc::{Rc, Weak};

use bun_alloc::AllocationScope;
use bun_collections::LinearFifo;
use bun_core::{Output, Timespec};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine};
use bun_jsc::jest::{self as Jest, TestRunner};
use bun_runtime::api::timer::EventLoopTimer;
use crate::cli::test_command::{self, CommandLineReporter};

bun_output::declare_scope!(bun_test_group, hidden);
// `group` in the Zig is `debug.group` (an Output.scoped). The macro form differs;
// callers use `group_log!` / `group_begin!` / `group_end!` below.
// TODO(port): wire to debug::group exactly once debug.rs is ported.

pub fn clone_active_strong() -> Option<BunTestPtr> {
    let runner = Jest::runner()?;
    runner.bun_test_root.clone_active_file()
}

pub use super::done_callback::DoneCallback;

pub mod js_fns {
    use super::*;

    pub enum Signature<'a> {
        ScopeFunctions(&'a ScopeFunctions),
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

    pub struct GetActiveCfg<'a> {
        pub signature: Signature<'a>,
        pub allow_in_preload: bool,
    }

    fn get_active_test_root<'a>(
        global_this: &JSGlobalObject,
        cfg: &GetActiveCfg<'a>,
    ) -> JsResult<&'static mut BunTestRoot> {
        // TODO(port): lifetime — Jest.runner is a process-global; modeled as &'static mut here.
        let Some(runner) = Jest::runner() else {
            return Err(global_this.throw(format_args!(
                "Cannot use {} outside of the test runner. Run \"bun test\" to run tests.",
                cfg.signature
            )));
        };
        let bun_test_root = &mut runner.bun_test_root;
        let vm = global_this.bun_vm();
        if vm.is_in_preload && !cfg.allow_in_preload {
            return Err(global_this.throw(format_args!(
                "Cannot use {} during preload.",
                cfg.signature
            )));
        }
        Ok(bun_test_root)
    }

    pub fn clone_active_strong(
        global_this: &JSGlobalObject,
        cfg: &GetActiveCfg<'_>,
    ) -> JsResult<BunTestPtr> {
        let bun_test_root = get_active_test_root(global_this, cfg)?;
        let Some(bun_test) = bun_test_root.clone_active_file() else {
            return Err(global_this.throw(format_args!(
                "Cannot use {} outside of a test file.",
                cfg.signature
            )));
        };
        Ok(bun_test)
    }

    /// Tags accepted by `generic_hook`. Superset of `DescribeScope::HookTag`
    /// (adds `OnTestFinished`).
    #[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy, strum::IntoStaticStr)]
    pub enum GenericHookTag {
        #[strum(serialize = "beforeAll")]
        BeforeAll,
        #[strum(serialize = "beforeEach")]
        BeforeEach,
        #[strum(serialize = "afterEach")]
        AfterEach,
        #[strum(serialize = "afterAll")]
        AfterAll,
        #[strum(serialize = "onTestFinished")]
        OnTestFinished,
    }
    impl GenericHookTag {
        const fn as_hook_tag(self) -> Option<HookTag> {
            match self {
                Self::BeforeAll => Some(HookTag::BeforeAll),
                Self::BeforeEach => Some(HookTag::BeforeEach),
                Self::AfterEach => Some(HookTag::AfterEach),
                Self::AfterAll => Some(HookTag::AfterAll),
                Self::OnTestFinished => None,
            }
        }
        /// `@tagName(tag) ++ "()"` — comptime string, so a const per-variant table.
        const fn sig(self) -> &'static [u8] {
            match self {
                Self::BeforeAll => b"beforeAll()",
                Self::BeforeEach => b"beforeEach()",
                Self::AfterEach => b"afterEach()",
                Self::AfterAll => b"afterAll()",
                Self::OnTestFinished => b"onTestFinished()",
            }
        }
    }

    // Zig: `fn genericHook(comptime tag) type { return struct { pub fn hookFn(...) } }`
    pub struct GenericHook<const TAG: GenericHookTag>;
    impl<const TAG: GenericHookTag> GenericHook<TAG> {
        #[bun_jsc::host_fn]
        pub fn hook_fn(
            global_this: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
            debug::group::begin();
            let _g = scopeguard::guard((), |_| debug::group::end());
            // errdefer group.log("ended in error", .{}) — handled by ? paths implicitly logging
            // TODO(port): errdefer side-effect log on error path

            let tag_name: &'static str = TAG.into();
            let sig_bytes: &'static [u8] = TAG.sig();

            let mut args = ScopeFunctions::parse_arguments(
                global_this,
                call_frame,
                Signature::Str(sig_bytes),
                ScopeFunctions::ParseArgsCfg { callback: ScopeFunctions::CallbackReq::Require, kind: ScopeFunctions::Kind::Hook },
            )?;
            // defer args.deinit() → Drop

            let has_done_parameter = if let Some(callback) = args.callback {
                callback.get_length(global_this)? > 0
            } else {
                false
            };

            let bun_test_root = get_active_test_root(
                global_this,
                &GetActiveCfg { signature: Signature::Str(sig_bytes), allow_in_preload: true },
            )?;

            let cfg = ExecutionEntryCfg {
                has_done_parameter,
                timeout: args.options.timeout,
                ..Default::default()
            };

            let Some(bun_test) = bun_test_root.get_active_file_unless_in_preload(global_this.bun_vm()) else {
                if TAG == GenericHookTag::OnTestFinished {
                    return Err(global_this.throw(format_args!(
                        "Cannot call {}() in preload. It can only be called inside a test.",
                        tag_name
                    )));
                }
                bun_output::scoped_log!(bun_test_group, "genericHook in preload");

                let _ = bun_test_root.hook_scope.append_hook(
                    TAG.as_hook_tag().unwrap(),
                    args.callback,
                    cfg,
                    BaseScopeCfg::default(),
                    AddedInPhase::Preload,
                )?;
                return Ok(JSValue::UNDEFINED);
            };

            match bun_test.phase {
                Phase::Collection => {
                    if TAG == GenericHookTag::OnTestFinished {
                        return Err(global_this.throw(format_args!(
                            "Cannot call {}() outside of a test. It can only be called inside a test.",
                            tag_name
                        )));
                    }
                    let _ = bun_test.collection.active_scope.append_hook(
                        TAG.as_hook_tag().unwrap(),
                        args.callback,
                        cfg,
                        BaseScopeCfg::default(),
                        AddedInPhase::Collection,
                    )?;
                    Ok(JSValue::UNDEFINED)
                }
                Phase::Execution => {
                    let active = bun_test.get_current_state_data();
                    let Some((sequence, _)) = bun_test.execution.get_current_and_valid_execution_sequence(&active) else {
                        return Err(if TAG == GenericHookTag::OnTestFinished {
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

                    let append_point: *mut ExecutionEntry = match TAG {
                        GenericHookTag::AfterAll | GenericHookTag::AfterEach => 'blk: {
                            let mut iter = sequence.active_entry;
                            while let Some(entry) = iter {
                                // SAFETY: intrusive linked-list nodes are valid while sequence is live
                                let entry_ref = unsafe { &mut *entry };
                                if Some(entry) == sequence.test_entry {
                                    break 'blk sequence.test_entry.unwrap();
                                }
                                iter = entry_ref.next;
                            }
                            match sequence.active_entry {
                                Some(e) => break 'blk e,
                                None => {
                                    return Err(global_this.throw(format_args!(
                                        "Cannot call {}() here. Call it inside describe() instead.",
                                        tag_name
                                    )));
                                }
                            }
                        }
                        GenericHookTag::OnTestFinished => 'blk: {
                            // Find the last entry in the sequence
                            let Some(mut last_entry) = sequence.active_entry else {
                                return Err(global_this.throw(format_args!(
                                    "Cannot call {}() here. Call it inside a test instead.",
                                    tag_name
                                )));
                            };
                            // SAFETY: intrusive linked-list traversal
                            unsafe {
                                while let Some(next_entry) = (*last_entry).next {
                                    last_entry = next_entry;
                                }
                            }
                            break 'blk last_entry;
                        }
                        _ => {
                            return Err(global_this.throw(format_args!(
                                "Cannot call {}() inside a test. Call it inside describe() instead.",
                                tag_name
                            )));
                        }
                    };

                    let new_item = ExecutionEntry::create(
                        None,
                        args.callback,
                        cfg,
                        None,
                        BaseScopeCfg::default(),
                        AddedInPhase::Execution,
                    );
                    let new_item_ptr = Box::into_raw(new_item);
                    // SAFETY: append_point is a valid linked-list node; new_item_ptr just allocated
                    unsafe {
                        (*new_item_ptr).next = (*append_point).next;
                        (*append_point).next = Some(new_item_ptr);
                    }
                    bun_test.extra_execution_entries.push(new_item_ptr);
                    // PERF(port): was bun.handleOom(append) — Vec::push aborts on OOM

                    Ok(JSValue::UNDEFINED)
                }
                Phase::Done => Err(global_this.throw(format_args!(
                    "Cannot call {}() after the test run has completed",
                    tag_name
                ))),
            }
        }
    }
}

/// `bun.ptr.shared.WithOptions(*BunTest, .{ .allow_weak = true, .Allocator = bun.DefaultAllocator })`
/// → `Rc<BunTest>` (single-thread, weak-capable).
// TODO(port): BunTest is mutated through this handle pervasively. Phase B must
// pick between `Rc<RefCell<BunTest>>` and an intrusive shared ptr that hands
// out `&mut`. For now type aliases keep call sites readable.
pub type BunTestPtr = Rc<BunTest>;
pub type BunTestPtrWeak = Weak<BunTest>;
pub type BunTestPtrOptional = Option<Rc<BunTest>>;

pub struct BunTestRoot {
    // gpa dropped — global mimalloc
    pub active_file: BunTestPtrOptional,
    pub hook_scope: Box<DescribeScope>,
}

impl BunTestRoot {
    pub fn init() -> BunTestRoot {
        let hook_scope = DescribeScope::create(BaseScope {
            parent: None,
            name: None,
            concurrent: false,
            mode: ScopeMode::Normal,
            only: Only::No,
            has_callback: false,
            test_id_for_debugger: 0,
            line_no: 0,
        });
        BunTestRoot {
            active_file: None,
            hook_scope,
        }
    }

    /// Drop preload-level hooks registered in the previous global. The next
    /// file's `loadPreloads()` re-registers them against the fresh global.
    pub fn reset_hook_scope_for_test_isolation(&mut self) {
        debug_assert!(self.hook_scope.entries.is_empty());
        // drop old, create fresh
        self.hook_scope = DescribeScope::create(BaseScope {
            parent: None,
            name: None,
            concurrent: false,
            mode: ScopeMode::Normal,
            only: Only::No,
            has_callback: false,
            test_id_for_debugger: 0,
            line_no: 0,
        });
    }

    pub fn enter_file(
        &mut self,
        file_id: TestRunner::FileId,
        reporter: &mut CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());

        debug_assert!(self.active_file.is_none());

        // Zig: active_file = .new(undefined); active_file.get().?.init(...)
        // TODO(port): in-place init — Rc::new_cyclic or two-phase init may be
        // needed because BunTest stores a backref to BunTestRoot.
        let bun_test = Rc::new(BunTest::init(
            self as *const BunTestRoot,
            file_id,
            Some(reporter),
            default_concurrent,
            first_last,
        ));
        self.active_file = Some(bun_test);
    }

    pub fn exit_file(&mut self) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());

        debug_assert!(self.active_file.is_some());
        if let Some(active) = &self.active_file {
            // TODO(port): interior mutability — need &mut through Rc
            // SAFETY: single-threaded; BunTestRoot is sole strong owner here per assert above semantics
            unsafe {
                let p = Rc::as_ptr(active) as *mut BunTest;
                (*p).reporter = None;
            }
        }
        self.active_file = None; // drops the Rc (deinit)
    }

    pub fn get_active_file_unless_in_preload(&mut self, vm: &VirtualMachine) -> Option<&mut BunTest> {
        if vm.is_in_preload {
            return None;
        }
        // TODO(port): interior mutability — see BunTestPtr note
        // SAFETY: single-threaded; BunTestRoot owns the only strong ref while not in preload
        self.active_file.as_ref().map(|rc| unsafe { &mut *(Rc::as_ptr(rc) as *mut BunTest) })
    }

    pub fn clone_active_file(&self) -> Option<BunTestPtr> {
        self.active_file.clone()
    }

    pub fn on_before_print(&self) {
        if let Some(active_file) = &self.active_file {
            if let Some(reporter) = active_file.reporter {
                // SAFETY: reporter outlives the active file by construction (cleared in exit_file)
                let reporter = unsafe { &mut *(reporter as *const CommandLineReporter as *mut CommandLineReporter) };
                // TODO(port): reporter is Option<&'a CommandLineReporter> per LIFETIMES; mutation needs reshaping
                if reporter.reporters.dots && reporter.last_printed_dot {
                    Output::pretty_error("<r>\n");
                    Output::flush();
                    reporter.last_printed_dot = false;
                }
                if let Some(runner) = Jest::runner() {
                    runner.current_file.print_if_needed();
                }
            }
        }
    }
}

impl Drop for BunTestRoot {
    fn drop(&mut self) {
        debug_assert!(self.hook_scope.entries.is_empty()); // entries must not be appended to the hook_scope
        // hook_scope: Box dropped automatically
        debug_assert!(self.active_file.is_none());
    }
}

#[derive(Copy, Clone)]
pub struct FirstLast {
    pub first: bool,
    pub last: bool,
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

pub struct BunTest<'a> {
    pub bun_test_root: *const BunTestRoot,
    pub in_run_loop: bool,
    pub allocation_scope: AllocationScope,
    // gpa / arena_allocator / arena dropped — see §Allocators (non-AST crate)
    // PERF(port): was arena bulk-free for per-file scratch
    pub file_id: TestRunner::FileId,
    /// null if the runner has moved on to the next file but a strong reference to BunTest is still keeping it alive
    pub reporter: Option<&'a CommandLineReporter>,
    // TODO(port): mutation through &'a CommandLineReporter (on_before_print writes last_printed_dot) — reshape to Cell/&mut in Phase B
    pub timer: EventLoopTimer,
    pub result_queue: ResultQueue,
    /// Whether tests in this file should default to concurrent execution
    pub default_concurrent: bool,
    pub first_last: FirstLast,
    pub extra_execution_entries: Vec<*mut ExecutionEntry>,
    pub wants_wakeup: bool,

    pub phase: Phase,
    pub collection: Collection,
    pub execution: Execution,
}

impl<'a> BunTest<'a> {
    pub fn init(
        bun_test_root: *const BunTestRoot,
        file_id: TestRunner::FileId,
        reporter: Option<&'a CommandLineReporter>,
        default_concurrent: bool,
        first_last: FirstLast,
    ) -> Self {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());

        // Zig sets up allocation_scope/gpa/arena first then re-assigns *this.
        // In Rust we construct directly.
        let allocation_scope = AllocationScope::init();

        BunTest {
            bun_test_root,
            in_run_loop: false,
            allocation_scope,
            phase: Phase::Collection,
            file_id,
            collection: Collection::init(bun_test_root),
            execution: Execution::init(),
            reporter,
            result_queue: ResultQueue::new(),
            default_concurrent,
            first_last,
            extra_execution_entries: Vec::new(),
            timer: EventLoopTimer { next: Timespec::EPOCH, tag: EventLoopTimer::Tag::BunTest, ..Default::default() },
            wants_wakeup: false,
        }
    }

    pub fn get_current_state_data(&self) -> RefDataValue {
        match self.phase {
            Phase::Collection => RefDataValue::Collection {
                active_scope: self.collection.active_scope,
            },
            Phase::Execution => 'blk: {
                let Some(active_group) = self.execution.active_group() else {
                    debug_assert!(false); // should have switched phase if we're calling getCurrentStateData, but it could happen with re-entry maybe
                    break 'blk RefDataValue::Done;
                };
                let sequences = active_group.sequences(&self.execution);
                if sequences.len() != 1 {
                    break 'blk RefDataValue::Execution {
                        group_index: self.execution.group_index,
                        entry_data: None, // the current execution entry is not known because we are running a concurrent test
                    };
                }

                let active_sequence_index = 0usize;
                let sequence = &sequences[active_sequence_index];

                let Some(active_entry) = sequence.active_entry else {
                    break 'blk RefDataValue::Execution {
                        group_index: self.execution.group_index,
                        entry_data: None, // the sequence is completed.
                    };
                };

                RefDataValue::Execution {
                    group_index: self.execution.group_index,
                    entry_data: Some(EntryData {
                        sequence_index: active_sequence_index,
                        entry: active_entry as *const (),
                        remaining_repeat_count: sequence.remaining_repeat_count,
                    }),
                }
            }
            Phase::Done => RefDataValue::Done,
        }
    }

    pub fn ref_(this_strong: &BunTestPtr, phase: RefDataValue) -> RefDataPtr {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        bun_output::scoped_log!(bun_test_group, "ref: {}", phase);

        bun_ptr::IntrusiveRc::new(RefData {
            buntest_weak: Rc::downgrade(this_strong),
            phase,
            ref_count: Cell::new(1),
        })
    }

    fn bun_test_then_or_catch(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        is_catch: bool,
    ) -> JsResult<()> {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // TODO(port): errdefer group.log("ended in error")

        let [result, this_ptr] = callframe.arguments_as_array::<2>();
        if this_ptr.is_empty_or_undefined_or_null() {
            return Ok(());
        }

        // SAFETY: this_ptr was created by wrapping a RefDataPtr via asPromisePtr; we adopt the +1 it carried
        let refdata: RefDataPtr = unsafe { bun_ptr::IntrusiveRc::from_raw(this_ptr.as_promise_ptr::<RefData>()) };
        // defer refdata.deref() → IntrusiveRc::drop at end of scope
        let has_one_ref = refdata.has_one_ref();
        let Some(this_strong) = refdata.buntest_weak.upgrade() else {
            bun_output::scoped_log!(bun_test_group, "bunTestThenOrCatch -> the BunTest is no longer active");
            return Ok(());
        };
        // SAFETY: see BunTestPtr TODO — interior mutability
        let this = unsafe { &mut *(Rc::as_ptr(&this_strong) as *mut BunTest) };

        if is_catch {
            this.on_uncaught_exception(global_this, Some(result), true, refdata.phase.clone());
        }
        if !has_one_ref && !is_catch {
            bun_output::scoped_log!(bun_test_group, "bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref");
            return Ok(());
        }

        this.add_result(refdata.phase.clone());
        Self::run_next_tick(&refdata.buntest_weak, global_this, refdata.phase.clone());
        Ok(())
    }

    #[bun_jsc::host_fn]
    fn bun_test_then(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::bun_test_then_or_catch(global_this, callframe, false)?;
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn bun_test_catch(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::bun_test_then_or_catch(global_this, callframe, true)?;
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn bun_test_done_callback(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());

        let Some(this) = DoneCallback::from_js(callframe.this()) else {
            return Err(global_this.throw(format_args!("Expected callee to be DoneCallback")));
        };

        let [value] = callframe.arguments_as_array::<1>();

        let was_error = !value.is_empty_or_undefined_or_null();
        if this.called {
            // in Bun 1.2.20, this is a no-op
            // in Jest, this is "Expected done to be called once, but it was called multiple times."
            // Vitest does not support done callbacks
        } else {
            // error is only reported for the first done() call
            if was_error {
                let _ = global_this.bun_vm().uncaught_exception(global_this, value, false);
            }
        }
        this.called = true;
        let Some(ref_in) = this.r#ref.take() else {
            return Ok(JSValue::UNDEFINED);
        };
        // defer this.ref = null → already taken above
        // defer ref_in.deref() → IntrusiveRc::drop at end of scope

        // dupe the ref and enqueue a task to call the done callback.
        // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.

        let has_one_ref = ref_in.has_one_ref();
        let should_run = has_one_ref || was_error;

        if !should_run {
            return Ok(JSValue::UNDEFINED);
        }

        let Some(strong) = ref_in.buntest_weak.upgrade() else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: see BunTestPtr TODO
        let buntest = unsafe { &mut *(Rc::as_ptr(&strong) as *mut BunTest) };
        buntest.add_result(ref_in.phase.clone());
        Self::run_next_tick(&ref_in.buntest_weak, global_this, ref_in.phase.clone());

        Ok(JSValue::UNDEFINED)
    }

    pub fn bun_test_timeout_callback(
        this_strong: BunTestPtr,
        _ts: &Timespec,
        vm: &VirtualMachine,
    ) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // SAFETY: see BunTestPtr TODO
        let this = unsafe { &mut *(Rc::as_ptr(&this_strong) as *mut BunTest) };
        this.timer.next = Timespec::EPOCH;
        this.timer.state = EventLoopTimer::State::Pending;

        match this.phase {
            Phase::Collection => {}
            Phase::Execution => {
                if let Err(e) = this.execution.handle_timeout(vm.global) {
                    this.on_uncaught_exception(vm.global, Some(vm.global.take_exception(e)), false, RefDataValue::Done);
                }
            }
            Phase::Done => {}
        }
        if let Err(e) = Self::run(this_strong.clone(), vm.global) {
            this.on_uncaught_exception(vm.global, Some(vm.global.take_exception(e)), false, RefDataValue::Done);
        }
    }

    pub fn run_next_tick(weak: &BunTestPtrWeak, global_this: &JSGlobalObject, phase: RefDataValue) {
        let done_callback_test = Box::new(RunTestsTask {
            weak: weak.clone(),
            global_this,
            phase,
        });
        // errdefer bun.destroy(done_callback_test) → Box drops on early return
        let task = jsc::ManagedTask::new::<RunTestsTask>(done_callback_test, RunTestsTask::call);
        let vm = global_this.bun_vm();
        let Some(strong) = weak.upgrade() else {
            if cfg!(feature = "ci_assert") {
                debug_assert!(false); // shouldn't be calling runNextTick after moving on to the next file
            }
            return; // but just in case
        };
        // SAFETY: see BunTestPtr TODO
        unsafe { (*(Rc::as_ptr(&strong) as *mut BunTest)).wants_wakeup = true; }
        // we need to wake up the event loop so autoTick() doesn't wait for 16-100ms because we just enqueued a task
        vm.enqueue_task(task);
    }

    pub fn add_result(&mut self, result: RefDataValue) {
        self.result_queue.write_item(result);
        // PERF(port): was bun.handleOom — Vec/Deque push aborts on OOM
    }

    pub fn run(this_strong: BunTestPtr, global_this: &JSGlobalObject) -> JsResult<()> {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // SAFETY: see BunTestPtr TODO
        let this = unsafe { &mut *(Rc::as_ptr(&this_strong) as *mut BunTest) };

        if this.in_run_loop {
            return Ok(());
        }
        this.in_run_loop = true;
        let _reset = scopeguard::guard(&mut this.in_run_loop, |r| *r = false);
        // TODO(port): errdefer/defer overlap with &mut this — reshape for borrowck

        let mut min_timeout = Timespec::EPOCH;

        while let Some(result) = this.result_queue.read_item() {
            global_this.clear_termination_exception();
            let step_result: StepResult = match this.phase {
                Phase::Collection => Collection::step(this_strong.clone(), global_this, result)?,
                Phase::Execution => Execution::step(this_strong.clone(), global_this, result)?,
                Phase::Done => StepResult::Complete,
            };
            match step_result {
                StepResult::Waiting { timeout } => {
                    min_timeout = Timespec::min_ignore_epoch(min_timeout, timeout);
                }
                StepResult::Complete => {
                    if this._advance(global_this)? == Advance::Exit {
                        return Ok(());
                    }
                    this.add_result(RefDataValue::Start);
                }
            }
        }

        this.update_min_timeout(global_this, &min_timeout);
        Ok(())
    }

    fn update_min_timeout(&mut self, global_this: &JSGlobalObject, min_timeout: &Timespec) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        bun_output::scoped_log!(
            bun_test_group,
            "-> timeout: {} {}, {}",
            min_timeout,
            self.timer.next,
            <&'static str>::from(min_timeout.order_ignore_epoch(&self.timer.next))
        );
        if min_timeout.order_ignore_epoch(&self.timer.next) == core::cmp::Ordering::Less {
            bun_output::scoped_log!(bun_test_group, "-> setting timer to {}", min_timeout);
            if !self.timer.next.eql(&Timespec::EPOCH) {
                bun_output::scoped_log!(bun_test_group, "-> removing existing timer");
                global_this.bun_vm().timer.remove(&mut self.timer);
            }
            self.timer.next = *min_timeout;
            if !self.timer.next.eql(&Timespec::EPOCH) {
                bun_output::scoped_log!(bun_test_group, "-> inserting timer");
                global_this.bun_vm().timer.insert(&mut self.timer);
                if debug::group::get_log_enabled() {
                    let duration = self.timer.next.duration(&Timespec::now_force_real_time());
                    bun_output::scoped_log!(bun_test_group, "-> timer duration: {}", duration);
                }
            }
            bun_output::scoped_log!(bun_test_group, "-> timer set");
        }
    }

    fn _advance(&mut self, _global_this: &JSGlobalObject) -> JsResult<Advance> {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        bun_output::scoped_log!(bun_test_group, "advance from {}", <&'static str>::from(self.phase));
        let _g2 = scopeguard::guard((), |_| {
            bun_output::scoped_log!(bun_test_group, "advance -> {}", <&'static str>::from(self.phase));
        });
        // TODO(port): defer captures &self.phase; reshape for borrowck

        match self.phase {
            Phase::Collection => {
                self.phase = Phase::Execution;
                debug::dump_describe(self.collection.root_scope)?;

                let has_filter = if let Some(reporter) = self.reporter {
                    reporter.jest.filter_regex.is_some()
                } else {
                    false
                };
                // Derive a per-file shuffle PRNG from (seed, file_path) so a
                // file's test order depends only on the path and the printed
                // seed — not on which worker ran it or what files preceded it
                // on that worker. This is what makes --parallel --randomize
                // reproducible via --seed=N.
                let mut per_file_prng: Option<bun_core::random::DefaultPrng> = if let Some(reporter) = self.reporter {
                    'blk: {
                        let Some(seed) = reporter.jest.randomize_seed else { break 'blk None };
                        let path = reporter.jest.files.items_source()[self.file_id as usize].path.text;
                        // Basename only so the hash is platform-independent (path
                        // separators and absolute prefixes differ on Windows).
                        Some(bun_core::random::DefaultPrng::init(
                            bun_wyhash::hash(bun_paths::basename(path)).wrapping_add(seed),
                        ))
                    }
                } else {
                    None
                };
                let should_randomize = per_file_prng.as_mut().map(|p| p.random());
                // TODO(port): std.Random / DefaultPrng mapping — confirm bun_core::random API

                let mut order = Order::init(Order::Cfg {
                    always_use_hooks: self.collection.root_scope.base.only == Only::No && !has_filter,
                    randomize: should_randomize,
                });
                // defer order.deinit() → Drop

                // SAFETY: bun_test_root backref valid while self is live (BunTestRoot owns self)
                let root = unsafe { &*self.bun_test_root };
                let beforeall_order: Order::AllOrderResult = if self.first_last.first {
                    order.generate_all_order(&root.hook_scope.before_all)?
                } else {
                    Order::AllOrderResult::EMPTY
                };
                order.generate_order_describe(self.collection.root_scope)?;
                beforeall_order.set_failure_skip_to(&mut order);
                let afterall_order: Order::AllOrderResult = if self.first_last.last {
                    order.generate_all_order(&root.hook_scope.after_all)?
                } else {
                    Order::AllOrderResult::EMPTY
                };
                afterall_order.set_failure_skip_to(&mut order);

                self.execution.load_from_order(&order)?;
                debug::dump_order(&self.execution)?;
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
    pub fn run_test_callback(
        this_strong: BunTestPtr,
        global_this: &JSGlobalObject,
        cfg_callback: JSValue,
        cfg_done_parameter: bool,
        cfg_data: RefDataValue,
        timeout: &Timespec,
    ) -> Option<RefDataValue> {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // SAFETY: see BunTestPtr TODO
        let this = unsafe { &mut *(Rc::as_ptr(&this_strong) as *mut BunTest) };
        let vm = global_this.bun_vm();

        // Don't use Option<JSValue> to make it harder for the conservative stack
        // scanner to miss it.
        let mut done_arg: JSValue = JSValue::ZERO;
        let mut done_callback: JSValue = JSValue::ZERO;

        if cfg_done_parameter {
            bun_output::scoped_log!(bun_test_group, "callTestCallback -> appending done callback param: data {}", cfg_data);
            done_callback = DoneCallback::create_unbound(global_this);
            done_arg = match DoneCallback::bind(done_callback, global_this) {
                Ok(v) => v,
                Err(e) => {
                    this.on_uncaught_exception(global_this, Some(global_this.take_exception(e)), false, cfg_data.clone());
                    JSValue::ZERO // failed to bind done callback
                }
            };
        }

        this.update_min_timeout(global_this, timeout);
        let args_slice: &[JSValue] = if !done_arg.is_empty() { core::slice::from_ref(&done_arg) } else { &[] };
        let result: JSValue = match vm.event_loop().run_callback_with_result_and_forcefully_drain_microtasks(
            cfg_callback,
            global_this,
            JSValue::UNDEFINED,
            args_slice,
        ) {
            Ok(v) => v,
            Err(_) => {
                global_this.clear_termination_exception();
                this.on_uncaught_exception(global_this, global_this.try_take_exception(), false, cfg_data.clone());
                bun_output::scoped_log!(bun_test_group, "callTestCallback -> error");
                JSValue::ZERO
            }
        };

        done_callback.ensure_still_alive();

        // Drain unhandled promise rejections.
        loop {
            // Prevent the user's Promise rejection from going into the uncaught promise rejection queue.
            if !result.is_empty() {
                if let Some(promise) = result.as_promise() {
                    if promise.status() == jsc::PromiseStatus::Rejected {
                        promise.set_handled();
                    }
                }
            }

            let prev_unhandled_count = vm.unhandled_error_counter;
            global_this.handle_rejected_promises();
            if vm.unhandled_error_counter == prev_unhandled_count {
                break;
            }
        }

        let mut dcb_ref: Option<RefDataPtr> = None;
        if !done_callback.is_empty() && !result.is_empty() {
            if let Some(dcb_data) = DoneCallback::from_js(done_callback) {
                if dcb_data.called {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    let r = Self::ref_(&this_strong, cfg_data.clone());
                    dcb_data.r#ref = Some(r.clone());
                    dcb_ref = Some(r);
                    // TODO(port): Zig stored the same pointer twice without bumping; verify DoneCallback owns a counted ref vs. raw alias
                }
            } else {
                debug_assert!(false); // this should be unreachable, we create DoneCallback above
            }
        }

        if !result.is_empty() {
            if let Some(promise) = result.as_promise() {
                let _keep = bun_jsc::EnsureStillAlive(result); // because sometimes we use promise without result

                bun_output::scoped_log!(bun_test_group, "callTestCallback -> promise: data {}", cfg_data);

                match promise.status() {
                    jsc::PromiseStatus::Pending => {
                        // not immediately resolved; register 'then' to handle the result when it becomes available
                        let this_ref: RefDataPtr = if let Some(dcb_ref_value) = &dcb_ref {
                            dcb_ref_value.clone()
                        } else {
                            Self::ref_(&this_strong, cfg_data.clone())
                        };
                        let _ = result.then(global_this, bun_ptr::IntrusiveRc::into_raw(this_ref), Self::bun_test_then, Self::bun_test_catch);
                        // TODO: properly propagate exception upwards
                        return None;
                    }
                    jsc::PromiseStatus::Fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        return Some(cfg_data);
                    }
                    jsc::PromiseStatus::Rejected => {
                        let value = promise.result(global_this.vm());
                        this.on_uncaught_exception(global_this, Some(value), true, cfg_data.clone());

                        // We previously marked it as handled above.

                        return Some(cfg_data);
                    }
                }
            }
        }

        if dcb_ref.is_some() {
            // completed asynchronously
            bun_output::scoped_log!(bun_test_group, "callTestCallback -> wait for done callback");
            return None;
        }

        bun_output::scoped_log!(bun_test_group, "callTestCallback -> sync");
        Some(cfg_data)
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    pub fn on_uncaught_exception(
        &mut self,
        global_this: &JSGlobalObject,
        exception: Option<JSValue>,
        is_rejection: bool,
        user_data: RefDataValue,
    ) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());

        let _ = is_rejection;

        let handle_status: HandleUncaughtExceptionResult = match self.phase {
            Phase::Collection => self.collection.handle_uncaught_exception(&user_data),
            Phase::Done => HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests,
            Phase::Execution => self.execution.handle_uncaught_exception(&user_data),
        };

        bun_output::scoped_log!(bun_test_group, "onUncaughtException -> {}", <&'static str>::from(handle_status));

        if handle_status == HandleUncaughtExceptionResult::HideError {
            return; // do not print error, it was already consumed
        }
        let Some(exception) = exception else {
            return; // the exception should not be visible (eg m_terminationException)
        };

        // SAFETY: bun_test_root backref valid while self is live
        unsafe { &*self.bun_test_root }.on_before_print();
        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            // TODO(port): reporter is Option<&'a> but mutated here; needs reshaping
            self.reporter.unwrap().jest.unhandled_errors_between_tests += 1;
            // TODO(port): the line above mutates through &; cast away in Phase B or make field Cell
            Output::pretty_errorln(
                "<r>\n<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>\n<d>-------------------------------<r>\n",
            );
            Output::flush();
        }

        global_this.bun_vm().run_error_handler(exception, None);

        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            Output::pretty_error("<r><d>-------------------------------<r>\n\n");
        }

        Output::flush();
    }
}

impl<'a> Drop for BunTest<'a> {
    fn drop(&mut self) {
        debug::group::begin();
        debug::group::end();

        if self.timer.state == EventLoopTimer::State::Active {
            // must remove an active timer to prevent UAF (if the timer were to trigger after BunTest deinit)
            VirtualMachine::get().timer.remove(&mut self.timer);
        }

        for entry in self.extra_execution_entries.drain(..) {
            // SAFETY: entries were Box::into_raw'd in generic_hook; we own them
            unsafe { drop(Box::from_raw(entry)); }
        }
        // execution, collection, result_queue, allocation_scope: dropped automatically
        // PERF(port): was arena bulk-free (arena_allocator.deinit)
    }
}

// `export const Bun__TestScope__Describe2__bunTestThen = jsc.toJSHostFn(bunTestThen);`
// TODO(port): move to <area>_sys
#[unsafe(no_mangle)]
pub static Bun__TestScope__Describe2__bunTestThen: jsc::JSHostFn =
    jsc::to_js_host_fn(BunTest::bun_test_then);
#[unsafe(no_mangle)]
pub static Bun__TestScope__Describe2__bunTestCatch: jsc::JSHostFn =
    jsc::to_js_host_fn(BunTest::bun_test_catch);

#[derive(Copy, Clone)]
pub struct EntryData {
    pub sequence_index: usize,
    pub entry: *const (),
    pub remaining_repeat_count: i64,
}

#[derive(Clone)]
pub enum RefDataValue {
    Start,
    Collection {
        // LIFETIMES.tsv: BORROW_PARAM &'a DescribeScope — but stored across async
        // boundaries (promise .then); falling back to UNKNOWN-class NonNull until Phase B.
        // TODO(port): lifetime
        active_scope: core::ptr::NonNull<DescribeScope>,
    },
    Execution {
        group_index: usize,
        entry_data: Option<EntryData>,
    },
    Done,
}

impl RefDataValue {
    pub fn group<'a>(&self, buntest: &'a mut BunTest) -> Option<&'a mut Execution::ConcurrentGroup> {
        let RefDataValue::Execution { group_index, .. } = self else { return None };
        Some(&mut buntest.execution.groups[*group_index])
    }

    pub fn sequence<'a>(&self, buntest: &'a mut BunTest) -> Option<&'a mut Execution::ExecutionSequence> {
        let RefDataValue::Execution { entry_data, .. } = self else { return None };
        let entry_data = (*entry_data)?;
        // PORT NOTE: reshaped for borrowck — split group lookup from sequences indexing
        let group_item = self.group(buntest)?;
        Some(&mut group_item.sequences_mut(&mut buntest.execution)[entry_data.sequence_index])
        // TODO(port): overlapping &mut buntest.execution borrows; reshape in Phase B
    }

    pub fn entry<'a>(&self, buntest: &'a mut BunTest) -> Option<&'a mut ExecutionEntry> {
        if !matches!(self, RefDataValue::Execution { .. }) {
            return None;
        }
        if buntest.phase != Phase::Execution {
            return None;
        }
        let (the_sequence, _) = buntest.execution.get_current_and_valid_execution_sequence(self)?;
        // SAFETY: active_entry is a valid intrusive node while the sequence is live
        the_sequence.active_entry.map(|p| unsafe { &mut *p })
    }
}

impl fmt::Display for RefDataValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RefDataValue::Start => write!(f, "start"),
            RefDataValue::Collection { active_scope } => {
                // SAFETY: active_scope is valid for the duration of collection phase
                let name = unsafe { &active_scope.as_ref().base.name };
                match name {
                    Some(n) => write!(f, "collection: active_scope={}", bstr::BStr::new(n.as_ref())),
                    None => write!(f, "collection: active_scope=null"),
                }
            }
            RefDataValue::Execution { group_index, entry_data } => {
                if let Some(ed) = entry_data {
                    write!(
                        f,
                        "execution: group_index={},sequence_index={},entry_index={:x},remaining_repeat_count={}",
                        group_index, ed.sequence_index, ed.entry as usize, ed.remaining_repeat_count
                    )
                } else {
                    write!(f, "execution: group_index={}", group_index)
                }
            }
            RefDataValue::Done => write!(f, "done"),
        }
    }
}

pub struct RefData {
    pub buntest_weak: BunTestPtrWeak,
    pub phase: RefDataValue,
    pub ref_count: Cell<u32>,
}
// `bun.ptr.RefCount(RefData, "ref_count", #destroy, .{})` — intrusive single-thread refcount.
// `*RefData` crosses FFI (asPromisePtr), so this MUST be `bun_ptr::IntrusiveRc`, never `Rc`.
pub type RefDataPtr = bun_ptr::IntrusiveRc<RefData>;
impl bun_ptr::IntrusiveRefCounted for RefData {
    fn ref_count(&self) -> &Cell<u32> {
        &self.ref_count
    }
    fn destroy(this: *mut RefData) {
        debug::group::begin();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // SAFETY: refcount hit zero; we own the allocation
        unsafe {
            bun_output::scoped_log!(bun_test_group, "refData: {}", (*this).phase);
            // buntest_weak.deinit() → Weak::drop
            drop(Box::from_raw(this));
        }
    }
}
impl RefData {
    pub fn has_one_ref(&self) -> bool {
        self.ref_count.get() == 1
    }
    pub fn bun_test(&self) -> Option<BunTestPtr> {
        self.buntest_weak.upgrade()
    }
}

pub struct RunTestsTask {
    pub weak: BunTestPtrWeak,
    pub global_this: &'static JSGlobalObject,
    // TODO(port): lifetime — JSGlobalObject borrow stored across task tick
    pub phase: RefDataValue,
}
impl RunTestsTask {
    pub fn call(this: Box<RunTestsTask>) {
        // defer bun.destroy(this) → Box drops at end of scope
        // defer this.weak.deinit() → Weak drops with Box
        let Some(strong) = this.weak.upgrade() else { return };
        if let Err(e) = BunTest::run(strong.clone(), this.global_this) {
            // SAFETY: see BunTestPtr TODO
            let bt = unsafe { &mut *(Rc::as_ptr(&strong) as *mut BunTest) };
            bt.on_uncaught_exception(
                this.global_this,
                Some(this.global_this.take_exception(e)),
                false,
                this.phase.clone(),
            );
        }
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

pub type ResultQueue = LinearFifo<RefDataValue>;
// TODO(port): bun.LinearFifo(.Dynamic) — confirm bun_collections has this; else VecDeque

pub enum StepResult {
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

pub use super::collection::Collection;

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum ConcurrentMode {
    #[default]
    Inherit,
    No,
    Yes,
}

#[derive(Copy, Clone, Default)]
pub struct BaseScopeCfg {
    pub self_concurrent: ConcurrentMode,
    pub self_mode: ScopeMode,
    pub self_only: bool,
    pub test_id_for_debugger: i32,
    pub line_no: u32,
}
impl BaseScopeCfg {
    /// returns None if the other already has the value
    pub fn extend(self, other: BaseScopeCfg) -> Option<BaseScopeCfg> {
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
        Some(result)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum ScopeMode {
    #[default]
    Normal,
    Skip,
    Todo,
    Failing,
    FilteredOut,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Only {
    No,
    Contains,
    Yes,
}

pub struct BaseScope {
    pub parent: Option<*const DescribeScope>,
    pub name: Option<Box<[u8]>>,
    pub concurrent: bool,
    pub mode: ScopeMode,
    pub only: Only,
    pub has_callback: bool,
    /// this value is 0 unless the debugger is active and the scope has a debugger id
    pub test_id_for_debugger: i32,
    /// only available if using junit reporter, otherwise 0
    pub line_no: u32,
}
impl BaseScope {
    pub fn init(
        cfg: BaseScopeCfg,
        name_not_owned: Option<&[u8]>,
        parent: Option<*const DescribeScope>,
        has_callback: bool,
    ) -> BaseScope {
        let parent_base = parent.map(|p| unsafe { &(*p).base });
        // SAFETY: parent backref valid for construction read
        BaseScope {
            parent,
            name: name_not_owned.map(|name| Box::<[u8]>::from(name)),
            concurrent: match cfg.self_concurrent {
                ConcurrentMode::Yes => true,
                ConcurrentMode::No => false,
                ConcurrentMode::Inherit => parent_base.map_or(false, |p| p.concurrent),
            },
            mode: if let Some(p) = parent_base {
                if p.mode != ScopeMode::Normal { p.mode } else { cfg.self_mode }
            } else {
                cfg.self_mode
            },
            only: if cfg.self_only { Only::Yes } else { Only::No },
            has_callback,
            test_id_for_debugger: cfg.test_id_for_debugger,
            line_no: cfg.line_no,
        }
    }

    pub fn propagate(&mut self, has_callback: bool) {
        self.has_callback = has_callback;
        if let Some(parent) = self.parent {
            // SAFETY: parent backref valid; tree is single-threaded and parent outlives child
            let parent = unsafe { &mut *(parent as *mut DescribeScope) };
            if self.only != Only::No {
                parent.mark_contains_only();
            }
            if self.has_callback {
                parent.mark_has_callback();
            }
        }
    }
}
// deinit: only frees `name` → Box<[u8]> drops automatically; no explicit Drop needed.

pub struct DescribeScope {
    pub base: BaseScope,
    pub entries: Vec<TestScheduleEntry>,
    pub before_all: Vec<Box<ExecutionEntry>>,
    pub before_each: Vec<Box<ExecutionEntry>>,
    pub after_each: Vec<Box<ExecutionEntry>>,
    pub after_all: Vec<Box<ExecutionEntry>>,

    /// if true, the describe callback threw an error. do not run any tests declared in this scope.
    pub failed: bool,
}

impl DescribeScope {
    pub fn create(base: BaseScope) -> Box<DescribeScope> {
        Box::new(DescribeScope {
            base,
            entries: Vec::new(),
            before_each: Vec::new(),
            before_all: Vec::new(),
            after_all: Vec::new(),
            after_each: Vec::new(),
            failed: false,
        })
    }
    // destroy → Drop on Box<DescribeScope>; all fields own their contents.

    fn mark_contains_only(&mut self) {
        let mut target: Option<*mut DescribeScope> = Some(self as *mut _);
        while let Some(scope_ptr) = target {
            // SAFETY: walking parent backrefs; tree is single-threaded
            let scope = unsafe { &mut *scope_ptr };
            if scope.base.only == Only::Contains {
                return; // already marked
            }
            // note that we overwrite '.yes' with '.contains' to support only-inside-only
            scope.base.only = Only::Contains;
            target = scope.base.parent.map(|p| p as *mut DescribeScope);
        }
    }

    fn mark_has_callback(&mut self) {
        let mut target: Option<*mut DescribeScope> = Some(self as *mut _);
        while let Some(scope_ptr) = target {
            // SAFETY: walking parent backrefs; tree is single-threaded
            let scope = unsafe { &mut *scope_ptr };
            if scope.base.has_callback {
                return; // already marked
            }
            scope.base.has_callback = true;
            target = scope.base.parent.map(|p| p as *mut DescribeScope);
        }
    }

    pub fn append_describe(
        &mut self,
        name_not_owned: Option<&[u8]>,
        base: BaseScopeCfg,
    ) -> JsResult<&mut DescribeScope> {
        let mut child = Self::create(BaseScope::init(base, name_not_owned, Some(self as *const _), false));
        child.base.propagate(false);
        self.entries.push(TestScheduleEntry::Describe(child));
        // TODO(port): narrow error set
        match self.entries.last_mut().unwrap() {
            TestScheduleEntry::Describe(d) => Ok(&mut **d),
            _ => unreachable!(),
        }
    }

    pub fn append_test(
        &mut self,
        name_not_owned: Option<&[u8]>,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> JsResult<&mut ExecutionEntry> {
        let mut entry = ExecutionEntry::create(name_not_owned, callback, cfg, Some(self as *const _), base, phase);
        let has_cb = entry.callback.is_some();
        entry.base.propagate(has_cb);
        self.entries.push(TestScheduleEntry::TestCallback(entry));
        match self.entries.last_mut().unwrap() {
            TestScheduleEntry::TestCallback(e) => Ok(&mut **e),
            _ => unreachable!(),
        }
    }

    pub fn get_hook_entries(&mut self, tag: HookTag) -> &mut Vec<Box<ExecutionEntry>> {
        match tag {
            HookTag::BeforeAll => &mut self.before_all,
            HookTag::BeforeEach => &mut self.before_each,
            HookTag::AfterEach => &mut self.after_each,
            HookTag::AfterAll => &mut self.after_all,
        }
    }

    pub fn append_hook(
        &mut self,
        tag: HookTag,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> JsResult<&mut ExecutionEntry> {
        let entry = ExecutionEntry::create(None, callback, cfg, Some(self as *const _), base, phase);
        let list = self.get_hook_entries(tag);
        list.push(entry);
        Ok(&mut **list.last_mut().unwrap())
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum HookTag {
    BeforeAll,
    BeforeEach,
    AfterEach,
    AfterAll,
}

#[derive(Copy, Clone, Default)]
pub struct ExecutionEntryCfg {
    /// 0 = unlimited timeout
    pub timeout: u32,
    pub has_done_parameter: bool,
    /// Number of times to retry a failed test (0 = no retries)
    pub retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub repeat_count: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AddedInPhase {
    Preload,
    Collection,
    Execution,
}

pub struct ExecutionEntry {
    pub base: BaseScope,
    pub callback: Option<Strong>,
    /// 0 = unlimited timeout
    pub timeout: u32,
    pub has_done_parameter: bool,
    /// '.epoch' = not set
    /// when this entry begins executing, the timespec will be set to the current time plus the timeout(ms).
    pub timespec: Timespec,
    pub added_in_phase: AddedInPhase,
    /// Number of times to retry a failed test (0 = no retries)
    pub retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub repeat_count: u32,

    pub next: Option<*mut ExecutionEntry>,
    /// if this entry fails, go to the entry 'failure_skip_past.next'
    pub failure_skip_past: Option<*mut ExecutionEntry>,
}

impl ExecutionEntry {
    fn create(
        name_not_owned: Option<&[u8]>,
        cb: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        parent: Option<*const DescribeScope>,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> Box<ExecutionEntry> {
        let mut entry = Box::new(ExecutionEntry {
            base: BaseScope::init(base, name_not_owned, parent, cb.is_some()),
            callback: None,
            timeout: cfg.timeout,
            has_done_parameter: cfg.has_done_parameter,
            added_in_phase: phase,
            retry_count: cfg.retry_count,
            repeat_count: cfg.repeat_count,
            timespec: Timespec::EPOCH,
            next: None,
            failure_skip_past: None,
        });

        if let Some(c) = cb {
            entry.callback = match entry.base.mode {
                ScopeMode::Skip => None,
                ScopeMode::Todo => {
                    let run_todo = Jest::runner().map_or(false, |runner| runner.run_todo);
                    if run_todo { Some(Strong::init(c)) } else { None }
                }
                _ => Some(Strong::init(c)),
            };
        }
        entry
    }

    pub fn evaluate_timeout(
        &self,
        sequence: &mut Execution::ExecutionSequence,
        now: &Timespec,
    ) -> bool {
        if !self.timespec.eql(&Timespec::EPOCH) && self.timespec.order(now) == core::cmp::Ordering::Less {
            // timed out
            sequence.result = if Some(self as *const _ as *mut _) == sequence.test_entry {
                if self.has_done_parameter {
                    Execution::SequenceResult::FailBecauseTimeoutWithDoneCallback
                } else {
                    Execution::SequenceResult::FailBecauseTimeout
                }
            } else if self.has_done_parameter {
                Execution::SequenceResult::FailBecauseHookTimeoutWithDoneCallback
            } else {
                Execution::SequenceResult::FailBecauseHookTimeout
            };
            sequence.maybe_skip = true;
            return true;
        }
        false
    }
}
// destroy → Drop: callback (Strong) and base.name (Box) drop automatically.

pub enum TestScheduleEntry {
    Describe(Box<DescribeScope>),
    TestCallback(Box<ExecutionEntry>),
}
impl TestScheduleEntry {
    // deinit → Drop on the Box variants; nothing to write.
    pub fn base(&mut self) -> &mut BaseScope {
        match self {
            TestScheduleEntry::Describe(describe) => &mut describe.base,
            TestScheduleEntry::TestCallback(test_callback) => &mut test_callback.base,
        }
    }
}

pub enum RunOneResult {
    Done,
    Execute { timeout: Timespec },
}
impl Default for RunOneResult {
    fn default() -> Self {
        RunOneResult::Execute { timeout: Timespec::EPOCH }
    }
}

pub use super::timers::fake_timers::FakeTimers;
pub use super::execution::Execution;
pub use super::debug;
pub use super::scope_functions::ScopeFunctions;
pub use super::order::Order;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/bun_test.zig (1072 lines)
//   confidence: medium
//   todos:      22
//   notes:      BunTestPtr=Rc<BunTest> needs interior-mutability decision; BunTest<'a> reporter borrow is mutated (reshape); RefData uses bun_ptr::IntrusiveRc (crosses FFI via asPromisePtr); intrusive ExecutionEntry list kept raw; group.begin/end mapped to debug::group stubs.
// ──────────────────────────────────────────────────────────────────────────
