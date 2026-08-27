use core::cell::{Cell, RefCell};
use core::fmt;
use std::rc::{Rc, Weak};

use super::execution::{EntryId, EntryNode, TimespecExt as _};
use super::jest::{FileId, Jest};
use crate::cli::test_command::CommandLineReporter;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_core::{Output, Timespec};
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsResult, Strong};
use bun_ptr::{JsCell, ThisPtr};

bun_core::declare_scope!(bun_test_group, hidden);
// Callers use `group_log!` / `group_begin!` / `group_end!` below.
/// Thin macro over `debug::group::begin()` so call sites stay `group_begin!()`.
macro_rules! group_begin {
    () => {
        $crate::test_runner::debug::group::begin()
    };
}
pub(crate) use group_begin;


/// `bun.timespec.orderIgnoreEpoch` — epoch == "no timeout", treated as +∞.
/// Local helper so it can compare `bun_core::Timespec` against the
/// event-loop crate's distinct `Timespec` (converted by field).
// ElTimespec dedup is a separate ticket.
#[inline]
fn order_ignore_epoch(a: &Timespec, b: &ElTimespec) -> core::cmp::Ordering {
    Timespec::order_ignore_epoch(
        *a,
        Timespec {
            sec: b.sec,
            nsec: b.nsec,
        },
    )
}

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

pub use super::done_callback::DoneCallback;

pub mod js_fns {
    use super::*;

    #[derive(Clone, Copy)]
    pub enum Signature<'a> {
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
    ) -> JsResult<&'static BunTestRoot> {
        let Some(runner) = Jest::runner() else {
            return Err(global_this.throw(format_args!(
                "Cannot use {} outside of the test runner. Run \"bun test\" to run tests.",
                signature
            )));
        };
        Ok(&runner.bun_test_root)
    }

    pub(crate) fn clone_active_strong(
        global_this: &JSGlobalObject,
        signature: Signature<'_>,
    ) -> JsResult<BunTestPtr> {
        let bun_test_root = get_test_root(global_this, signature)?;
        if global_this.bun_vm().is_in_preload {
            return Err(global_this.throw(format_args!("Cannot use {} during preload.", signature)));
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
    // was a const-generic param (`adt_const_params` is unstable);
    // reshaped to runtime dispatch with per-tag thin host_fn wrappers below.
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
        /// Per-variant signature string: the tag name plus `"()"`.
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

    // `adt_const_params` is unstable, so the body takes `tag` at runtime and
    // 5 thin `#[host_fn]` wrappers below supply the per-tag entry points
    // (one fn per JS function so JSFunction::create gets a distinct address).
    pub(crate) fn generic_hook_impl(
        tag: GenericHookTag,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _g = group_begin!();
        // Run the body in a closure so every error exit funnels through the
        // log below before the group guard closes.
        let result = (|| -> JsResult<JSValue> {
            let tag_name: &'static str = tag.into();
            let sig_bytes: &'static [u8] = tag.sig();

            let args = ScopeFunctions::parse_arguments(
                global_this,
                call_frame,
                Signature::Str(sig_bytes),
                ScopeFunctions::ParseArgumentsCfg {
                    callback: ScopeFunctions::CallbackMode::Require,
                    kind: ScopeFunctions::FunctionKind::Hook,
                },
            )?;

            let has_done_parameter = if let Some(callback) = args.callback {
                callback.get_length(global_this)? > 0
            } else {
                false
            };

            let bun_test_root = get_test_root(global_this, Signature::Str(sig_bytes))?;

            let cfg = ExecutionEntryCfg {
                has_done_parameter,
                timeout: args.options.timeout,
                ..Default::default()
            };

            let Some(bun_test) = bun_test_root.active_file_unless_in_preload(global_this.bun_vm())
            else {
                if tag == GenericHookTag::OnTestFinished {
                    return Err(global_this.throw(format_args!(
                        "Cannot call {}() in preload. It can only be called inside a test.",
                        tag_name
                    )));
                }
                bun_core::scoped_log!(bun_test_group, "genericHook in preload");

                bun_test_root.hook_scope().append_hook(
                    tag.as_hook_tag().unwrap(),
                    args.callback,
                    cfg,
                    BaseScopeCfg::default(),
                    AddedInPhase::Preload,
                );
                return Ok(JSValue::UNDEFINED);
            };

            match bun_test.phase.get() {
                Phase::Collection => {
                    if tag == GenericHookTag::OnTestFinished {
                        return Err(global_this.throw(format_args!(
                            "Cannot call {}() outside of a test. It can only be called inside a test.",
                            tag_name
                        )));
                    }
                    bun_test.collection.active_scope().append_hook(
                        tag.as_hook_tag().unwrap(),
                        args.callback,
                        cfg,
                        BaseScopeCfg::default(),
                        AddedInPhase::Collection,
                    );
                    Ok(JSValue::UNDEFINED)
                }
                Phase::Execution => {
                    let active = bun_test.get_current_state_data();
                    let execution = &bun_test.execution;
                    let Some((sequence, _)) =
                        execution.get_current_and_valid_execution_sequence(&active)
                    else {
                        return Err(if tag == GenericHookTag::OnTestFinished {
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

                    let append_point: EntryId = match tag {
                        GenericHookTag::AfterAll | GenericHookTag::AfterEach => 'blk: {
                            let mut iter = sequence.active_entry.get();
                            while let Some(entry) = iter {
                                if Some(entry) == sequence.test_entry {
                                    break 'blk sequence.test_entry.unwrap();
                                }
                                iter = execution.next_of(entry);
                            }
                            match sequence.active_entry.get() {
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
                            let Some(mut last_entry) = sequence.active_entry.get() else {
                                return Err(global_this.throw(format_args!(
                                    "Cannot call {}() here. Call it inside a test instead.",
                                    tag_name
                                )));
                            };
                            while let Some(next_entry) = execution.next_of(last_entry) {
                                last_entry = next_entry;
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
                    let new_id = execution.push_node(EntryNode::new(new_item));
                    execution.set_next(new_id, execution.next_of(append_point));
                    execution.set_next(append_point, Some(new_id));

                    Ok(JSValue::UNDEFINED)
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

    /// Per-tag `#[host_fn]` entry points (one fn per JS function so
    /// `JSFunction::create` gets a distinct address).
    pub(crate) mod generic_hook {
        use super::*;
        macro_rules! hook {
            ($name:ident, $tag:ident) => {
                #[bun_jsc::host_fn]
                pub(crate) fn $name(
                    global_this: &JSGlobalObject,
                    call_frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    super::generic_hook_impl(GenericHookTag::$tag, global_this, call_frame)
                }
            };
        }
        hook!(before_all, BeforeAll);
        hook!(before_each, BeforeEach);
        hook!(after_each, AfterEach);
        hook!(after_all, AfterAll);
        hook!(on_test_finished, OnTestFinished);
    }
}

/// `Rc<BunTest>`: single-thread, weak-capable shared handle. Every JS-reachable
/// entry point can re-enter another on the same file, so `BunTest` is
/// `&self`-only and keeps its mutable state in `Cell`/`RefCell` fields whose
/// borrows never span a call that can run JS.
pub type BunTestPtr = Rc<BunTest>;
pub type BunTestPtrWeak = Weak<BunTest>;

pub struct BunTestRoot {
    pub(crate) active_file: RefCell<Option<BunTestPtr>>,
    pub(crate) hook_scope: RefCell<Rc<DescribeScope>>,
    /// One `Rc<RefData>` per pending `Promise.then()` registration: the
    /// reaction's context pointer is `Rc::as_ptr` of the entry, and the entry
    /// is what keeps it alive until the promise settles (or the run exits).
    pub(crate) pending_then_refs: RefCell<Vec<RefDataPtr>>,
    /// Monotonic per-`enter_file` counter. Exposed to JS so per-file module
    /// state (node:test root) resets on `--rerun-each` where `Bun.main` is
    /// unchanged across iterations.
    pub(crate) file_generation: Cell<u32>,
}

fn new_root_hook_scope() -> Rc<DescribeScope> {
    DescribeScope::create(BaseScope {
        parent: None,
        name: None,
        concurrent: false,
        mode: ScopeMode::Normal,
        only: Cell::new(Only::No),
        has_callback: Cell::new(false),
        test_id_for_debugger: Cell::new(0),
        line_no: 0,
    })
}

impl BunTestRoot {
    pub(crate) fn init() -> BunTestRoot {
        BunTestRoot {
            active_file: RefCell::new(None),
            hook_scope: RefCell::new(new_root_hook_scope()),
            pending_then_refs: RefCell::new(Vec::new()),
            file_generation: Cell::new(0),
        }
    }

    pub(crate) fn hook_scope(&self) -> Rc<DescribeScope> {
        Rc::clone(&self.hook_scope.borrow())
    }

    /// Drop preload-level hooks registered in the previous global. The next
    /// file's `loadPreloads()` re-registers them against the fresh global.
    pub(crate) fn reset_hook_scope_for_test_isolation(&self) {
        debug_assert!(self.hook_scope.borrow().entries.borrow().is_empty());
        // drop old, create fresh
        *self.hook_scope.borrow_mut() = new_root_hook_scope();
    }

    /// Tear down `bun:test` GC roots before `global_exit()` so
    /// `Zig__GlobalObject__destructOnExit()`'s `collectNow()` can reclaim the
    /// closures they pin. Releases the active file's per-test `Strong`s (the
    /// bail path skips its `scopeguard::defer! { exit_file() }` because
    /// `process::exit()` does not unwind) and the preload-hook `Strong`s held in
    /// `hook_scope`.
    pub(crate) fn deinit_for_exit(&self) {
        if self.active_file.borrow().is_some() {
            self.exit_file();
        }
        self.reset_hook_scope_for_test_isolation();
        // `pending_then_refs` is deliberately left populated: each entry is the
        // context of a still-registered promise reaction, holds no GC root
        // (only `Weak`s), and lives as long as this (leaked) root does, so a
        // reaction can never observe a freed `RefData`.
    }

    pub(crate) fn enter_file(
        &'static self,
        file_id: FileId,
        reporter: &'static CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) {
        let _g = group_begin!();

        debug_assert!(self.active_file.borrow().is_none());
        self.file_generation
            .set(self.file_generation.get().wrapping_add(1));

        let bun_test = BunTest::new(
            self,
            file_id,
            Some(reporter),
            default_concurrent,
            first_last,
        );
        *self.active_file.borrow_mut() = Some(bun_test);
    }

    pub(crate) fn exit_file(&self) {
        let _g = group_begin!();

        debug_assert!(self.active_file.borrow().is_some());
        let active = self.active_file.borrow_mut().take();
        if let Some(active) = &active {
            active.reporter.set(None);
        }
        drop(active); // drops the Rc (deinit)
    }

    pub(crate) fn active_file_unless_in_preload(&self, vm: &VirtualMachine) -> Option<BunTestPtr> {
        if vm.is_in_preload {
            return None;
        }
        self.clone_active_file()
    }

    pub(crate) fn clone_active_file(&self) -> Option<BunTestPtr> {
        self.active_file.borrow().clone()
    }

    pub(crate) fn on_before_print(&self) {
        let reporter = self
            .active_file
            .borrow()
            .as_ref()
            .and_then(|f| f.reporter.get());
        if let Some(reporter) = reporter {
            if reporter.reporters.dots && reporter.last_printed_dot.get() {
                bun_core::pretty_error!("<r>\n");
                Output::flush();
                reporter.last_printed_dot.set(false);
            }
            if let Some(runner) = Jest::runner() {
                runner.current_file.borrow_mut().print_if_needed();
            }
        }
    }
}

impl Drop for BunTestRoot {
    fn drop(&mut self) {
        debug_assert!(self.hook_scope.borrow().entries.borrow().is_empty()); // entries must not be appended to the hook_scope
        debug_assert!(self.active_file.borrow().is_none());
    }
}

#[derive(Copy, Clone)]
pub struct FirstLast {
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

pub struct BunTest {
    this: BunTestPtrWeak,
    pub(crate) bun_test_root: &'static BunTestRoot,
    /// The root preload-hook scope this file's `root_scope` is parented to;
    /// held so `Order` can reach its `beforeEach`/`afterEach` hooks for the
    /// whole run of this file.
    pub(crate) hook_scope: Rc<DescribeScope>,
    pub(crate) in_run_loop: Cell<bool>,
    pub(crate) file_id: FileId,
    /// `None` once the runner has moved on to the next file while a strong
    /// reference still keeps this `BunTest` alive. The reporter is leaked for
    /// the process lifetime by `test_command::exec`.
    pub(crate) reporter: Cell<Option<&'static CommandLineReporter>>,
    pub(crate) timer: JsCell<EventLoopTimer>,
    pub(crate) result_queue: RefCell<ResultQueue>,
    /// Whether tests in this file should default to concurrent execution
    pub(crate) default_concurrent: bool,
    pub(crate) first_last: FirstLast,
    pub(crate) wants_wakeup: Cell<bool>,

    pub(crate) phase: Cell<Phase>,
    pub(crate) execution: Execution::Execution,
    pub(crate) collection: Collection,
}

bun_event_loop::impl_timer_owner!(BunTest; from_timer_ptr => timer);

impl BunTest {
    fn new(
        bun_test_root: &'static BunTestRoot,
        file_id: FileId,
        reporter: Option<&'static CommandLineReporter>,
        default_concurrent: bool,
        first_last: FirstLast,
    ) -> Rc<Self> {
        let _g = group_begin!();

        let hook_scope = bun_test_root.hook_scope();
        Rc::new_cyclic(|this| BunTest {
            this: Weak::clone(this),
            bun_test_root,
            in_run_loop: Cell::new(false),
            phase: Cell::new(Phase::Collection),
            file_id,
            collection: Collection::init(&hook_scope),
            execution: Execution::Execution::init(),
            hook_scope,
            reporter: Cell::new(reporter),
            result_queue: RefCell::new(ResultQueue::new()),
            default_concurrent,
            first_last,
            // `EventLoopTimer` has no `Default`; `init_paused` sets
            // `next = EPOCH, state = PENDING`.
            timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::BunTest)),
            wants_wakeup: Cell::new(false),
        })
    }

    /// A strong handle to `self` (always live: every `&BunTest` is reached
    /// through an `Rc`).
    pub(crate) fn strong(&self) -> BunTestPtr {
        self.this.upgrade().expect("BunTest reached outside its Rc")
    }

    pub(crate) fn timer_state(&self) -> EventLoopTimerState {
        self.timer.get().state
    }

    pub(crate) fn timer_next(&self) -> ElTimespec {
        self.timer.get().next
    }

    pub(crate) fn get_current_state_data(&self) -> RefDataValue {
        match self.phase.get() {
            Phase::Collection => RefDataValue::Collection {
                active_scope: Rc::downgrade(&self.collection.active_scope()),
            },
            Phase::Execution => 'blk: {
                let Some(active_group) = self.execution.active_group() else {
                    debug_assert!(false); // should have switched phase if we're calling getCurrentStateData, but it could happen with re-entry maybe
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
                        entry: active_entry,
                        remaining_repeat_count: sequence.remaining_repeat_count.get() as i64,
                    }),
                }
            }
            Phase::Done => RefDataValue::Done,
        }
    }

    pub fn ref_(&self, phase: RefDataValue) -> RefDataPtr {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "ref: {}", phase);

        Rc::new(RefData {
            buntest_weak: Weak::clone(&self.this),
            phase,
        })
    }

    fn bun_test_then_or_catch(
        this: ThisPtr<RefData>,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        is_catch: bool,
    ) -> JsResult<()> {
        let _g = group_begin!();

        let [result, _] = callframe.arguments_as_array::<2>();

        // Take back the `Rc` that `run_test_callback` parked for this reaction;
        // it drops at scope exit so a paired done() callback observes
        // `has_one_ref()` on its turn.
        let Some(runner) = Jest::runner() else {
            return Ok(());
        };
        let refdata: RefDataPtr = {
            let mut pending = runner.bun_test_root.pending_then_refs.borrow_mut();
            let Some(pos) = pending
                .iter()
                .position(|p| core::ptr::eq(Rc::as_ptr(p), this.as_ptr()))
            else {
                return Ok(());
            };
            pending.swap_remove(pos)
        };
        let has_one_ref = refdata.has_one_ref();
        let Some(this_strong) = refdata.bun_test() else {
            bun_core::scoped_log!(
                bun_test_group,
                "bunTestThenOrCatch -> the BunTest is no longer active"
            );
            return Ok(());
        };

        if is_catch {
            this_strong.on_uncaught_exception(global_this, Some(result), true, &refdata.phase);
        }
        if !has_one_ref && !is_catch {
            bun_core::scoped_log!(
                bun_test_group,
                "bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref"
            );
            return Ok(());
        }

        this_strong.add_result(refdata.phase.clone());
        Self::run_next_tick(&refdata.buntest_weak, global_this, refdata.phase.clone());
        Ok(())
    }

    pub(crate) fn bun_test_done_callback(
        this: &DoneCallback,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let _g = group_begin!();

        let [value] = callframe.arguments_as_array::<1>();

        let was_error = !value.is_empty_or_undefined_or_null();
        if this.called.get() {
            // in Bun 1.2.20, this is a no-op
            // in Jest, this is "Expected done to be called once, but it was called multiple times."
            // Vitest does not support done callbacks
        } else {
            // error is only reported for the first done() call
            if was_error {
                let _ = global_this
                    .bun_vm()
                    .as_mut()
                    .uncaught_exception(global_this, value, false);
            }
        }
        this.called.set(true);
        let Some(ref_in) = this.r#ref.take() else {
            return Ok(JSValue::UNDEFINED);
        };
        // `ref_in` drops at scope exit so the paired promise then/catch path
        // sees `has_one_ref()` on its turn.

        // dupe the ref and enqueue a task to call the done callback.
        // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.

        let has_one_ref = ref_in.has_one_ref();
        let should_run = has_one_ref || was_error;

        if !should_run {
            return Ok(JSValue::UNDEFINED);
        }

        let Some(strong) = ref_in.bun_test() else {
            return Ok(JSValue::UNDEFINED);
        };
        strong.add_result(ref_in.phase.clone());
        Self::run_next_tick(&ref_in.buntest_weak, global_this, ref_in.phase.clone());

        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn bun_test_timeout_callback(&self, _ts: &Timespec, vm: &VirtualMachine) {
        let _g = group_begin!();
        let global = vm.global();
        self.timer.with_mut(|t| {
            t.next = ElTimespec::EPOCH;
            t.state = EventLoopTimerState::PENDING;
        });

        match self.phase.get() {
            Phase::Collection => {}
            Phase::Execution => {
                if let Err(e) = self.execution.handle_timeout(self, global) {
                    self.on_uncaught_exception(
                        global,
                        Some(global.take_exception(e)),
                        false,
                        &RefDataValue::Done,
                    );
                }
            }
            Phase::Done => {}
        }
        if let Err(e) = self.run(global) {
            self.on_uncaught_exception(
                global,
                Some(global.take_exception(e)),
                false,
                &RefDataValue::Done,
            );
        }
    }

    pub(crate) fn run_next_tick(
        weak: &BunTestPtrWeak,
        global_this: &JSGlobalObject,
        phase: RefDataValue,
    ) {
        let vm = global_this.bun_vm().as_mut();
        // Check liveness before allocating so the early return doesn't strand a Box.
        let Some(strong) = weak.upgrade() else {
            debug_assert!(false); // shouldn't be calling runNextTick after moving on to the next file
            return; // but just in case
        };
        // If the task never runs (VM teardown), the queue drainer drops it.
        let task = jsc::ManagedTask::ManagedTask::new_boxed(Box::new(RunTestsTask {
            weak: Weak::clone(weak),
            global_this: GlobalRef::from(global_this),
            phase,
        }));
        strong.wants_wakeup.set(true);
        // we need to wake up the event loop so autoTick() doesn't wait for 16-100ms because we just enqueued a task
        vm.enqueue_task(task);
    }

    pub(crate) fn add_result(&self, result: RefDataValue) {
        self.result_queue.borrow_mut().push_back(result);
    }

    pub(crate) fn readable_results(&self) -> usize {
        self.result_queue.borrow().len()
    }

    fn next_result(&self) -> Option<RefDataValue> {
        self.result_queue.borrow_mut().pop_front()
    }

    pub(crate) fn run(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        let _g = group_begin!();
        let this = self.strong();

        if self.in_run_loop.get() {
            return Ok(());
        }
        self.in_run_loop.set(true);
        let _reset = scopeguard::guard((), |()| self.in_run_loop.set(false));

        let mut min_timeout = Timespec::EPOCH;

        while let Some(result) = self.next_result() {
            global_this.clear_termination_exception();
            let step_result: StepResult = match self.phase.get() {
                Phase::Collection => Collection::step(&this, global_this, &result)?,
                Phase::Execution => Execution::Execution::step(&this, global_this, &result)?,
                Phase::Done => StepResult::Complete,
            };
            match step_result {
                StepResult::Waiting { timeout } => {
                    min_timeout = min_timeout.min_ignore_epoch(timeout);
                }
                StepResult::Complete => {
                    if self.advance(global_this)? == Advance::Exit {
                        return Ok(());
                    }
                    self.add_result(RefDataValue::Start);
                }
            }
        }

        self.update_min_timeout(global_this, &min_timeout);
        Ok(())
    }

    fn update_min_timeout(&self, global_this: &JSGlobalObject, min_timeout: &Timespec) {
        let _g = group_begin!();
        let _ = global_this;
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        let next = self.timer_next();
        bun_core::scoped_log!(
            bun_test_group,
            "-> timeout: {:?} {}.{}, {:?}",
            min_timeout,
            next.sec,
            next.nsec,
            order_ignore_epoch(min_timeout, &next)
        );
        if order_ignore_epoch(min_timeout, &next) == core::cmp::Ordering::Less {
            bun_core::scoped_log!(bun_test_group, "-> setting timer to {:?}", min_timeout);
            if next != ElTimespec::EPOCH {
                bun_core::scoped_log!(bun_test_group, "-> removing existing timer");
                crate::jsc_hooks::timer_all_mut().remove(self.timer.as_ptr());
            }
            // `EventLoopTimer.next` uses the event-loop crate's local
            // `Timespec` (distinct from `bun_core::Timespec`); convert by field.
            let next = ElTimespec {
                sec: min_timeout.sec,
                nsec: min_timeout.nsec,
            };
            self.timer.with_mut(|t| t.next = next);
            if next != ElTimespec::EPOCH {
                bun_core::scoped_log!(bun_test_group, "-> inserting timer");
                crate::jsc_hooks::timer_all_mut().insert(self.timer.as_ptr());
                if debug::group::get_log_enabled() {
                    let duration = min_timeout.since_now_force_real_time();
                    bun_core::scoped_log!(bun_test_group, "-> timer duration: {}", duration);
                }
            }
            bun_core::scoped_log!(bun_test_group, "-> timer set");
        }
    }

    /// Unlink the file-level timeout timer if it is armed.
    pub(crate) fn remove_timer(&self) {
        crate::jsc_hooks::timer_all_mut().remove(self.timer.as_ptr());
    }

    fn advance(&self, _global_this: &JSGlobalObject) -> JsResult<Advance> {
        let _g = group_begin!();
        bun_core::scoped_log!(
            bun_test_group,
            "advance from {}",
            <&'static str>::from(self.phase.get())
        );
        scopeguard::defer! {
            bun_core::scoped_log!(bun_test_group, "advance -> {}", <&'static str>::from(self.phase.get()));
        }

        match self.phase.get() {
            Phase::Collection => {
                self.phase.set(Phase::Execution);
                debug::dump_describe(&self.collection.root_scope)?;

                let reporter = self.reporter.get();
                let has_filter = if let Some(reporter) = reporter {
                    reporter.jest.filter_regex.is_some()
                } else {
                    false
                };
                // Derive a per-file shuffle PRNG from (seed, file_path) so a
                // file's test order depends only on the path and the printed
                // seed — not on which worker ran it or what files preceded it
                // on that worker. This is what makes --parallel --randomize
                // reproducible via --seed=N.
                let mut per_file_prng: Option<bun_core::rand::DefaultPrng> = if let Some(reporter) =
                    reporter
                {
                    'blk: {
                        let Some(seed) = reporter.jest.randomize_seed else {
                            break 'blk None;
                        };
                        let path = reporter.jest.file_path(self.file_id).text;
                        // Basename only so the hash is platform-independent (path
                        // separators and absolute prefixes differ on Windows).
                        Some(bun_core::rand::DefaultPrng::init(
                            bun_wyhash::hash(bun_paths::basename(path)).wrapping_add(seed as u64),
                        ))
                    }
                } else {
                    None
                };
                // `Order::Config.randomize` takes the PRNG itself
                // (`Option<DefaultPrng>`), so pass it through directly.
                let should_randomize = per_file_prng.take();

                let mut order = Order::Order::init(Order::Config {
                    always_use_hooks: self.collection.root_scope.base.only.get() == Only::No
                        && !has_filter,
                    randomize: should_randomize,
                });

                let beforeall_order: Order::AllOrderResult = if self.first_last.first {
                    order.generate_all_order(&self.hook_scope.before_all.borrow())?
                } else {
                    Order::AllOrderResult::EMPTY
                };
                order.generate_order_describe(&self.collection.root_scope)?;
                beforeall_order.set_failure_skip_to(&mut order);
                let afterall_order: Order::AllOrderResult = if self.first_last.last {
                    order.generate_all_order(&self.hook_scope.after_all.borrow())?
                } else {
                    Order::AllOrderResult::EMPTY
                };
                afterall_order.set_failure_skip_to(&mut order);

                self.execution.load_from_order(&mut order);
                debug::dump_order(&self.execution)?;
                Ok(Advance::Cont)
            }
            Phase::Execution => {
                self.in_run_loop.set(false);
                self.phase.set(Phase::Done);
                Ok(Advance::Exit)
            }
            Phase::Done => Ok(Advance::Exit),
        }
    }

    /// if sync, the result is returned. if async, None is returned.
    pub(crate) fn run_test_callback(
        &self,
        global_this: &JSGlobalObject,
        cfg_callback: JSValue,
        cfg_done_parameter: bool,
        cfg_data: RefDataValue,
        timeout: &Timespec,
    ) -> Option<RefDataValue> {
        let _g = group_begin!();
        let vm = global_this.bun_vm();

        // Don't use Option<JSValue> to make it harder for the conservative stack
        // scanner to miss it.
        let mut done_arg: JSValue = JSValue::ZERO;
        let mut done_callback: JSValue = JSValue::ZERO;

        if cfg_done_parameter {
            bun_core::scoped_log!(
                bun_test_group,
                "callTestCallback -> appending done callback param: data {}",
                cfg_data
            );
            done_callback = DoneCallback::create_unbound(global_this);
            done_arg = match DoneCallback::bind(done_callback, global_this) {
                Ok(v) => v,
                Err(e) => {
                    self.on_uncaught_exception(
                        global_this,
                        Some(global_this.take_exception(e)),
                        false,
                        &cfg_data,
                    );
                    JSValue::ZERO // failed to bind done callback
                }
            };
        }

        self.update_min_timeout(global_this, timeout);
        let args_slice: &[JSValue] = if !done_arg.is_empty() {
            core::slice::from_ref(&done_arg)
        } else {
            &[]
        };
        let result: JSValue = match vm
            .event_loop_mut()
            .run_callback_with_result_and_forcefully_drain_microtasks(
                cfg_callback,
                global_this,
                JSValue::UNDEFINED,
                args_slice,
            ) {
            Ok(v) => v,
            Err(_) => {
                global_this.clear_termination_exception();
                self.on_uncaught_exception(
                    global_this,
                    global_this.try_take_exception(),
                    false,
                    &cfg_data,
                );
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
                    // S012: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
                    let promise = bun_jsc::JSPromise::opaque_mut(promise);
                    if promise.status() == PromiseStatus::Rejected {
                        promise.set_handled();
                    }
                }
            }

            let prev_unhandled_count = vm.unhandled_error_counter;
            let _ = global_this.handle_rejected_promises();
            if vm.unhandled_error_counter == prev_unhandled_count {
                break;
            }
        }

        // The `DoneCallback` that now holds a `RefData` for this callback, so the
        // pending-promise branch below can hand the same one to `Promise.then()`
        // and whichever of the two fires last sees `has_one_ref()`.
        let mut dcb_ref: Option<&DoneCallback> = None;
        if !done_callback.is_empty() && !result.is_empty() {
            if let Some(dcb_data) = done_callback.as_class_ref::<DoneCallback>() {
                if dcb_data.called.get() {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    dcb_data.r#ref.set(Some(self.ref_(cfg_data.clone())));
                    dcb_ref = Some(dcb_data);
                }
            } else {
                debug_assert!(false); // this should be unreachable, we create DoneCallback above
            }
        }

        if !result.is_empty() {
            if let Some(promise) = result.as_promise() {
                let _keep = bun_jsc::EnsureStillAlive(result); // because sometimes we use promise without result

                bun_core::scoped_log!(
                    bun_test_group,
                    "callTestCallback -> promise: data {}",
                    cfg_data
                );

                // S012: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
                match bun_jsc::JSPromise::opaque_mut(promise).status() {
                    PromiseStatus::Pending => {
                        // not immediately resolved; register 'then' to handle the result when it becomes available
                        let this_ref: RefDataPtr = match dcb_ref {
                            Some(dcb) => {
                                let r = dcb.r#ref.take();
                                let shared = r.clone();
                                dcb.r#ref.set(r);
                                shared.unwrap_or_else(|| self.ref_(cfg_data))
                            }
                            None => self.ref_(cfg_data),
                        };
                        // `pending_then_refs` owns this `Rc` until the promise settles
                        // (or forever, if it never does).
                        let raw_ref = Rc::as_ptr(&this_ref).cast_mut();
                        self.bun_test_root
                            .pending_then_refs
                            .borrow_mut()
                            .push(this_ref);
                        result.then(
                            global_this,
                            raw_ref,
                            crate::generated_host_exports::Bun__TestScope__Describe2__bunTestThen,
                            crate::generated_host_exports::Bun__TestScope__Describe2__bunTestCatch,
                        );
                        // TODO: properly propagate exception upwards
                        return None;
                    }
                    PromiseStatus::Fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        return Some(cfg_data);
                    }
                    PromiseStatus::Rejected => {
                        let value =
                            bun_jsc::JSPromise::opaque_mut(promise).result(global_this.vm());
                        self.on_uncaught_exception(global_this, Some(value), true, &cfg_data);

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
        Some(cfg_data)
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    pub(crate) fn on_uncaught_exception(
        &self,
        global_this: &JSGlobalObject,
        exception: Option<JSValue>,
        is_rejection: bool,
        user_data: &RefDataValue,
    ) {
        let _g = group_begin!();

        let _ = is_rejection;

        let handle_status: HandleUncaughtExceptionResult = match self.phase.get() {
            Phase::Collection => self.collection.handle_uncaught_exception(user_data),
            Phase::Done => HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests,
            Phase::Execution => self.execution.handle_uncaught_exception(user_data),
        };

        bun_core::scoped_log!(
            bun_test_group,
            "onUncaughtException -> {}",
            <&'static str>::from(handle_status)
        );

        if handle_status == HandleUncaughtExceptionResult::HideError {
            return; // do not print error, it was already consumed
        }
        let Some(exception) = exception else {
            return; // the exception should not be visible (eg m_terminationException)
        };

        let failure_reporter: Option<&'static CommandLineReporter> = 'ctx: {
            if handle_status != HandleUncaughtExceptionResult::ShowHandledError {
                break 'ctx None;
            }
            let Some(reporter) = self.reporter.get() else {
                break 'ctx None;
            };
            if !reporter.jest.test_options.reporters.junit {
                break 'ctx None;
            }
            Some(reporter)
        };

        self.bun_test_root.on_before_print();
        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            debug_assert!(self.reporter.get().is_some());
            if let Some(reporter) = self.reporter.get() {
                let n = &reporter.jest.unhandled_errors_between_tests;
                n.set(n.get() + 1);
            }
            bun_core::pretty_errorln!(
                "<r>\n<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>\n<d>-------------------------------<r>\n",
            );
            Output::flush();
        }

        let vm = global_this.bun_vm().as_mut();
        if let Some(reporter) = failure_reporter {
            vm.on_print_error_zig_exception =
                Some(crate::cli::test_command::TestFailure::record_cb);
            vm.on_print_error_zig_exception_ctx =
                core::ptr::from_ref::<CommandLineReporter>(reporter)
                    .cast_mut()
                    .cast();
        }
        vm.run_error_handler(exception, None);
        if failure_reporter.is_some() {
            vm.on_print_error_zig_exception = None;
            vm.on_print_error_zig_exception_ctx = core::ptr::null_mut();
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

impl Drop for BunTest {
    fn drop(&mut self) {
        let _g = group_begin!();

        if self.timer_state() == EventLoopTimerState::ACTIVE {
            // must remove an active timer to prevent UAF (if the timer were to trigger after BunTest deinit)
            self.remove_timer();
        }
        // execution, collection, result_queue: dropped automatically
    }
}

// `ZigGlobalObject::promiseHandlerID` (C++) compares the fn-ptr passed to
// `JSValue::then` against `&Bun__TestScope__Describe2__bunTestThen` by
// identity, so these must stay function exports.
// HOST_EXPORT(Bun__TestScope__Describe2__bunTestThen, jsc)
pub fn bun_test_then(
    this: ThisPtr<RefData>,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    BunTest::bun_test_then_or_catch(this, global, frame, false)?;
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__TestScope__Describe2__bunTestCatch, jsc)
pub fn bun_test_catch(
    this: ThisPtr<RefData>,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    BunTest::bun_test_then_or_catch(this, global, frame, true)?;
    Ok(JSValue::UNDEFINED)
}

#[derive(Copy, Clone)]
pub struct EntryData {
    pub(crate) sequence_index: usize,
    pub(crate) entry: EntryId,
    pub(crate) remaining_repeat_count: i64,
}

#[derive(Clone)]
pub enum RefDataValue {
    Start,
    Collection {
        // Names the scope to restore when the describe callback settles
        // (across the promise .then boundary). `Weak`: the tree is owned by
        // `BunTest.collection`, and an `expect()` created in a describe body
        // holds one of these — an owning edge would cycle through the JS
        // callbacks the tree's `Strong`s root.
        active_scope: Weak<DescribeScope>,
    },
    Execution {
        group_index: usize,
        entry_data: Option<EntryData>,
    },
    Done,
}

impl RefDataValue {
    pub(crate) fn sequence<'a>(
        &self,
        buntest: &'a BunTest,
    ) -> Option<&'a Execution::ExecutionSequence> {
        let RefDataValue::Execution {
            group_index,
            entry_data,
        } = self
        else {
            return None;
        };
        let entry_data = (*entry_data)?;
        let group = buntest.execution.groups().get(*group_index)?;
        let (start, end) = (group.sequence_start, group.sequence_end);
        buntest.execution.sequences()[start..end].get(entry_data.sequence_index)
    }

    pub(crate) fn entry(&self, buntest: &BunTest) -> Option<Rc<ExecutionEntry>> {
        if !matches!(self, RefDataValue::Execution { .. }) {
            return None;
        }
        if buntest.phase.get() != Phase::Execution {
            return None;
        }
        let (the_sequence, _) = buntest
            .execution
            .get_current_and_valid_execution_sequence(self)?;
        the_sequence
            .active_entry
            .get()
            .map(|id| buntest.execution.entry(id))
    }
}

impl fmt::Display for RefDataValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RefDataValue::Start => write!(f, "start"),
            RefDataValue::Collection { active_scope } => {
                match active_scope.upgrade().and_then(|s| s.base.name.clone()) {
                    Some(n) => write!(
                        f,
                        "collection: active_scope={}",
                        bstr::BStr::new(n.as_ref())
                    ),
                    None => write!(f, "collection: active_scope=null"),
                }
            }
            RefDataValue::Execution {
                group_index,
                entry_data,
            } => {
                if let Some(ed) = entry_data {
                    write!(
                        f,
                        "execution: group_index={},sequence_index={},entry_index={:x},remaining_repeat_count={}",
                        group_index,
                        ed.sequence_index,
                        ed.entry.index(),
                        ed.remaining_repeat_count
                    )
                } else {
                    write!(f, "execution: group_index={}", group_index)
                }
            }
            RefDataValue::Done => write!(f, "done"),
        }
    }
}

/// Completion context for one test-callback invocation. Shared (`Rc`) between
/// the `done()` callback, a pending `Promise.then()` registration
/// (`BunTestRoot::pending_then_refs`) and `expect()` instances created while it
/// ran; whichever completion signal drops the second-to-last handle sees
/// `has_one_ref()` and advances the runner.
pub struct RefData {
    pub(crate) buntest_weak: BunTestPtrWeak,
    pub(crate) phase: RefDataValue,
}
pub type RefDataPtr = Rc<RefData>;
impl RefData {
    pub(crate) fn bun_test(&self) -> Option<BunTestPtr> {
        self.buntest_weak.upgrade()
    }
}
pub(crate) trait RefDataRc {
    fn has_one_ref(&self) -> bool;
}
impl RefDataRc for Rc<RefData> {
    fn has_one_ref(&self) -> bool {
        Rc::strong_count(self) == 1
    }
}
impl Drop for RefData {
    fn drop(&mut self) {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "refData: {}", self.phase);
    }
}

pub struct RunTestsTask {
    pub(crate) weak: BunTestPtrWeak,
    // `GlobalRef` (not a borrow): the JSGlobalObject is stored across the task
    // tick, and the VM keeps it alive until shutdown.
    pub global_this: GlobalRef,
    pub(crate) phase: RefDataValue,
}
impl bun_event_loop::ManagedTask::RunOnce for RunTestsTask {
    fn run(self) -> JsResult<()> {
        let Some(strong) = self.weak.upgrade() else {
            return Ok(());
        };
        if let Err(e) = strong.run(&self.global_this) {
            // A termination is the tick's to fold, not a test failure.
            if self.global_this.has_pending_termination_exception() {
                return Err(e);
            }
            strong.on_uncaught_exception(
                &self.global_this,
                Some(self.global_this.take_exception(e)),
                false,
                &self.phase,
            );
        }
        Ok(())
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

pub type ResultQueue = std::collections::VecDeque<RefDataValue>;

pub enum StepResult {
    Waiting { timeout: Timespec },
    Complete,
}
impl Default for StepResult {
    fn default() -> Self {
        StepResult::Waiting {
            timeout: Timespec::EPOCH,
        }
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
    pub(crate) self_concurrent: ConcurrentMode,
    pub(crate) self_mode: ScopeMode,
    pub(crate) self_only: bool,
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

impl ScopeMode {
    /// Lowercase variant name (e.g. "skip", "filtered_out") for labels/diagnostics.
    pub(crate) fn tag_name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Skip => "skip",
            Self::Todo => "todo",
            Self::Failing => "failing",
            Self::FilteredOut => "filtered_out",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Only {
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

pub struct BaseScope {
    pub(crate) parent: Option<Weak<DescribeScope>>,
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
    pub(crate) fn init(
        cfg: BaseScopeCfg,
        name_not_owned: Option<&[u8]>,
        parent: Option<&Rc<DescribeScope>>,
        has_callback: bool,
    ) -> BaseScope {
        let parent_base = parent.map(|p| &p.base);
        BaseScope {
            parent: parent.map(Rc::downgrade),
            name: name_not_owned.map(Box::<[u8]>::from),
            concurrent: match cfg.self_concurrent {
                ConcurrentMode::Yes => true,
                ConcurrentMode::No => false,
                ConcurrentMode::Inherit => parent_base.is_some_and(|p| p.concurrent),
            },
            mode: if let Some(p) = parent_base {
                if p.mode != ScopeMode::Normal {
                    p.mode
                } else {
                    cfg.self_mode
                }
            } else {
                cfg.self_mode
            },
            only: Cell::new(if cfg.self_only { Only::Yes } else { Only::No }),
            has_callback: Cell::new(has_callback),
            test_id_for_debugger: Cell::new(cfg.test_id_for_debugger),
            line_no: cfg.line_no,
        }
    }

    pub(crate) fn parent(&self) -> Option<Rc<DescribeScope>> {
        self.parent.as_ref().and_then(Weak::upgrade)
    }

    pub(crate) fn propagate(&self, has_callback: bool) {
        self.has_callback.set(has_callback);
        if let Some(parent) = self.parent() {
            if self.only.get() != Only::No {
                parent.mark_contains_only();
            }
            if self.has_callback.get() {
                parent.mark_has_callback();
            }
        }
    }
}

pub struct DescribeScope {
    pub(crate) base: BaseScope,
    pub(crate) entries: RefCell<Vec<TestScheduleEntry>>,
    pub(crate) before_all: RefCell<Vec<Rc<ExecutionEntry>>>,
    pub(crate) before_each: RefCell<Vec<Rc<ExecutionEntry>>>,
    pub(crate) after_each: RefCell<Vec<Rc<ExecutionEntry>>>,
    pub(crate) after_all: RefCell<Vec<Rc<ExecutionEntry>>>,

    /// if true, the describe callback threw an error. do not run any tests declared in this scope.
    pub(crate) failed: Cell<bool>,
}

impl DescribeScope {
    pub(crate) fn create(base: BaseScope) -> Rc<DescribeScope> {
        Rc::new(DescribeScope {
            base,
            entries: RefCell::new(Vec::new()),
            before_each: RefCell::new(Vec::new()),
            before_all: RefCell::new(Vec::new()),
            after_all: RefCell::new(Vec::new()),
            after_each: RefCell::new(Vec::new()),
            failed: Cell::new(false),
        })
    }

    fn mark_contains_only(self: &Rc<Self>) {
        let mut target: Option<Rc<DescribeScope>> = Some(Rc::clone(self));
        while let Some(scope) = target {
            if scope.base.only.get() == Only::Contains {
                return; // already marked
            }
            // note that we overwrite '.yes' with '.contains' to support only-inside-only
            scope.base.only.set(Only::Contains);
            target = scope.base.parent();
        }
    }

    fn mark_has_callback(self: &Rc<Self>) {
        let mut target: Option<Rc<DescribeScope>> = Some(Rc::clone(self));
        while let Some(scope) = target {
            if scope.base.has_callback.get() {
                return; // already marked
            }
            scope.base.has_callback.set(true);
            target = scope.base.parent();
        }
    }

    /// Infallible: `Vec::push` aborts on OOM.
    pub(crate) fn append_describe(
        self: &Rc<Self>,
        name_not_owned: Option<&[u8]>,
        base: BaseScopeCfg,
    ) -> Rc<DescribeScope> {
        let child = Self::create(BaseScope::init(base, name_not_owned, Some(self), false));
        child.base.propagate(false);
        self.entries
            .borrow_mut()
            .push(TestScheduleEntry::Describe(Rc::clone(&child)));
        child
    }

    pub(crate) fn append_test(
        self: &Rc<Self>,
        name_not_owned: Option<&[u8]>,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> Rc<ExecutionEntry> {
        let entry = ExecutionEntry::create(name_not_owned, callback, cfg, Some(self), base, phase);
        let has_cb = entry.callback.is_some();
        entry.base.propagate(has_cb);
        self.entries
            .borrow_mut()
            .push(TestScheduleEntry::TestCallback(Rc::clone(&entry)));
        entry
    }

    pub(crate) fn get_hook_entries(&self, tag: HookTag) -> &RefCell<Vec<Rc<ExecutionEntry>>> {
        match tag {
            HookTag::BeforeAll => &self.before_all,
            HookTag::BeforeEach => &self.before_each,
            HookTag::AfterEach => &self.after_each,
            HookTag::AfterAll => &self.after_all,
        }
    }

    pub(crate) fn append_hook(
        self: &Rc<Self>,
        tag: HookTag,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> Rc<ExecutionEntry> {
        let entry = ExecutionEntry::create(None, callback, cfg, Some(self), base, phase);
        self.get_hook_entries(tag)
            .borrow_mut()
            .push(Rc::clone(&entry));
        entry
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
    pub(crate) timeout: u32,
    pub(crate) has_done_parameter: bool,
    /// Number of times to retry a failed test (0 = no retries)
    pub(crate) retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub(crate) repeat_count: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AddedInPhase {
    Preload,
    Collection,
    Execution,
}

/// A test or hook callback. Shared (`Rc`) between the collection tree and every
/// [`EntryNode`] the execution order schedules it at; per-run state (deadline,
/// `next` link) lives on the node.
pub struct ExecutionEntry {
    pub(crate) base: BaseScope,
    pub callback: Option<Strong>,
    /// 0 = unlimited timeout
    pub(crate) timeout: u32,
    pub(crate) has_done_parameter: bool,
    pub(crate) added_in_phase: AddedInPhase,
    /// Number of times to retry a failed test (0 = no retries)
    pub(crate) retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    pub(crate) repeat_count: u32,
}

impl ExecutionEntry {
    fn create(
        name_not_owned: Option<&[u8]>,
        cb: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        parent: Option<&Rc<DescribeScope>>,
        base: BaseScopeCfg,
        phase: AddedInPhase,
    ) -> Rc<ExecutionEntry> {
        let base = BaseScope::init(base, name_not_owned, parent, cb.is_some());
        let callback = match cb {
            None => None,
            Some(c) => match base.mode {
                ScopeMode::Skip => None,
                ScopeMode::Todo => {
                    let run_todo = Jest::runner().is_some_and(|runner| runner.run_todo);
                    if run_todo {
                        Some(strong_create(c))
                    } else {
                        None
                    }
                }
                _ => Some(strong_create(c)),
            },
        };
        Rc::new(ExecutionEntry {
            base,
            callback,
            timeout: cfg.timeout,
            has_done_parameter: cfg.has_done_parameter,
            added_in_phase: phase,
            retry_count: cfg.retry_count,
            repeat_count: cfg.repeat_count,
        })
    }
}

pub enum TestScheduleEntry {
    Describe(Rc<DescribeScope>),
    TestCallback(Rc<ExecutionEntry>),
}
impl TestScheduleEntry {
    pub(crate) fn base(&self) -> &BaseScope {
        match self {
            TestScheduleEntry::Describe(describe) => &describe.base,
            TestScheduleEntry::TestCallback(test_callback) => &test_callback.base,
        }
    }
}

// Module aliases so `Execution::ConcurrentGroup` / `Order::AllOrderResult`
// resolve as module paths without per-reference rewrites.
pub use super::debug;
pub use super::execution as Execution;
pub use super::order as Order;
pub use super::scope_functions as ScopeFunctions;
