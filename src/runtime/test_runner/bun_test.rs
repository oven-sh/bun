use core::cell::{Cell, OnceCell};
use core::fmt;
use core::num::NonZeroU32;
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use bun_core::{Output, Timespec};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue, JsClass as _, JsResult, Strong, StrongCell};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_ptr::{CellExt as _, RefPtr};
use bun_sema::util::SmallLocalVec;
use super::jest::{File, Jest};
use crate::jsc_hooks::timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, OwnedTimer};
use crate::cli::test_command::{CommandLineReporter, TestFailure};
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
    ) -> JsResult<&'static BunTestRoot> {
        let Some(runner) = Jest::runner() else {
            if jsc::virtual_machine::isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
                let place = if global_this.bun_vm().worker_ref().is_some() { "Worker" } else { "macro" };
                return Err(global_this.throw(format_args!("Cannot use {} in a {}.", signature, place)));
            }
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

            let Some(bun_test) = &bun_test_root.clone_active_file_unless_in_preload(global_this.bun_vm()) else {
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

            match bun_test.phase.get() {
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
                        let RefDataValue::Execution { group_index, entry_data: Some(entry_data) } = active else {
                            return Ok(());
                        };
                        if sequence_ref.test_entry.is_none() {
                            return Err(global_this.throw(format_args!(
                                "Cannot call {}() here. It can only be called inside a test.",
                                tag_name
                            )));
                        }
                        sequence_ref.context(global_this, bun_test, group_index, entry_data.sequence_index);
                        sequence_ref.defer(bun_test, when, callback, cfg.timeout);
                        return Ok(());
                    }
                    let append_point: SequenceEntryId = match tag {
                        GenericHookTag::AfterAll | GenericHookTag::AfterEach => {
                            let active_entry = sequence_ref.active_entry.get();
                            let test = bun_test.sequence_entries_from(active_entry).map(|(id, _)| id).find(|&id| Some(id) == sequence_ref.test_entry);
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
                            let Some((last_entry, _)) = bun_test.sequence_entries_from(sequence_ref.active_entry.get()).last() else {
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

                    let new_item = bun_test.create_sequence_entry(args.callback, cfg, AddedInPhase::Execution);
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

pub(crate) type BunTestPtr = Rc<BunTest>;
pub(crate) type BunTestPtrWeak = Weak<BunTest>;

pub(crate) struct BunTestRoot {
    active_file: Cell<Option<BunTestPtr>>,
    preload: Cell<Option<Rc<Preload>>>,
    /// One per awaited promise; its reactions look it up by address.
    pending_then_refs: Cell<Vec<RefPtr<RefData>>>,
    /// Monotonic per-`enter_file` counter. Exposed to JS so per-file module
    /// state (node:test root) resets on `--rerun-each` where `Bun.main` is
    /// unchanged across iterations.
    pub(crate) file_generation: Cell<u32>,
}

impl BunTestRoot {
    pub(crate) fn init() -> BunTestRoot {
        BunTestRoot {
            active_file: Cell::new(None),
            preload: Cell::new(None),
            pending_then_refs: Cell::default(),
            file_generation: Cell::new(0),
        }
    }

    fn preload(&self) -> Rc<Preload> {
        self.preload.with_taken(|preload| Rc::clone(preload.get_or_insert_with(Preload::create)))
    }

    /// Drop preload-level hooks registered in the previous global. The next
    /// file's `loadPreloads()` re-registers them against the fresh global.
    pub(crate) fn reset_preload_for_test_isolation(&self) {
        self.preload.set(None);
    }

    pub(crate) fn mark_timed_out(&self, group_index: usize, timed_out: EntryData) {
        let timed_out = RefDataValue::Execution { group_index, entry_data: Some(timed_out) };
        self.pending_then_refs.with_taken(|pending_then_refs| {
            for pending in pending_then_refs.iter().filter(|pending| pending.phase == timed_out) {
                pending.timed_out.set(true);
            }
        });
    }

    fn take_pending_then_ref(&self, key: *const RefData) -> Option<RefPtr<RefData>> {
        self.pending_then_refs.with_taken(|pending_then_refs| {
            let position = pending_then_refs.iter().position(|pending| core::ptr::eq(pending.as_ptr(), key))?;
            Some(pending_then_refs.swap_remove(position))
        })
    }

    /// Drops the runner's references before `global_exit()`, which does not unwind to `EnteredFile::drop`.
    pub(crate) fn deinit_for_exit(&self) {
        self.active_file.set(None);
        self.reset_preload_for_test_isolation();
        self.pending_then_refs.take();
    }

    pub(crate) fn enter_file(
        &self,
        file: File,
        reporter: &'static CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) {
        let _g = group_begin!();

        debug_assert!(!self.has_active_file());
        self.file_generation.update(|generation| generation.wrapping_add(1));

        self.active_file.set(Some(Rc::new(BunTest::init(
            self.preload(),
            self.file_generation.get(),
            file,
            reporter,
            default_concurrent,
            first_last,
        ))));
    }

    pub(crate) fn exit_file(&self) {
        let _g = group_begin!();

        debug_assert!(self.has_active_file());
        self.active_file.set(None);
    }

    fn clone_active_file_unless_in_preload(&self, vm: &VirtualMachine) -> Option<BunTestPtr> {
        if vm.is_in_preload.get() {
            return None;
        }
        self.clone_active_file()
    }

    pub(crate) fn clone_active_file(&self) -> Option<BunTestPtr> {
        self.active_file.with_taken(|active_file| active_file.clone())
    }

    pub(crate) fn has_active_file(&self) -> bool {
        self.active_file.with_taken(|active_file| active_file.is_some())
    }

    pub(crate) fn on_before_print(&self) {
        if let Some(reporter) = self.active_file.with_taken(|active_file| Some(active_file.as_ref()?.reporter)) {
            if reporter.reporters.dots && reporter.last_printed_dot.take() {
                bun_core::pretty_error!("<r>\n");
                Output::flush();
            }
            reporter.jest.current_file.print_if_needed();
        }
    }
}

/// Index into `BunTest::scopes` plus one, or `PRELOAD`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct ScopeId(NonZeroU32);

impl ScopeId {
    /// The file's own scope.
    pub(crate) const ROOT: ScopeId = ScopeId(NonZeroU32::MIN);
    /// The parent of `ROOT`.
    const PRELOAD: ScopeId = ScopeId(NonZeroU32::MAX);
}

/// Index into `BunTest::entries`, or `Preload::entries` with `PRELOAD_BIT`, plus one.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct EntryId(NonZeroU32);

impl EntryId {
    const PRELOAD_BIT: u32 = 1 << 31;
}

/// Index into `BunTest::sequence_entries`, plus one.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct SequenceEntryId(NonZeroU32);

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
pub(crate) struct SequenceEntry {
    pub(crate) entry: EntryId,
    pub(crate) next: Cell<Option<SequenceEntryId>>,
    /// if this entry fails, go to the entry 'failure_skip_past.next'
    pub(crate) failure_skip_past: Cell<Option<SequenceEntryId>>,
    /// When the entry began executing, plus its timeout. `EPOCH` = not set.
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
    in_run_loop: Cell<bool>,
    pub(crate) file: File,
    /// `BunTestRoot::file_generation` of this run of the file.
    pub(crate) generation: u32,
    pub(crate) reporter: &'static CommandLineReporter,
    pub(crate) timer: OwnedTimer,
    result_queue: Cell<VecDeque<RefDataValue>>,
    /// Whether tests in this file should default to concurrent execution
    pub(crate) default_concurrent: bool,
    pub(crate) first_last: FirstLast,
    preload: Rc<Preload>,
    scopes: SmallLocalVec<DescribeScope>,
    entries: SmallLocalVec<ExecutionEntry>,
    sequence_entries: SmallLocalVec<SequenceEntry>,
    pub(crate) wants_wakeup: Cell<bool>,
    /// The phase passed to the most recent `run_next_tick`.
    pending_phase: Cell<RefDataValue>,
    /// Set while the global unhandled-error handler reports an error through `on_uncaught_exception`.
    pub(crate) is_reporting_uncaught: Cell<bool>,
    recording_target: Cell<Option<RecordingTarget>>,
    unhandled_failure: Cell<Option<TestFailure>>,
    /// True until `TestCommand::run` starts the runner, because the file's module may still be registering tests.
    pub(crate) is_loading: Cell<bool>,
    /// Callback-less entry that runs last in the file. `defer_to_file_end` links its entries after it.
    file_end: OnceCell<SequenceEntryId>,
    pub(crate) unclaimed: super::expect::expect_deferred::Unclaimed,

    pub(crate) phase: Cell<Phase>,
    pub(crate) collection: Collection,
    pub(crate) execution: Execution::Execution,
}

/// Where `BunTest::record_printed_error` puts the errors that are printed.
#[derive(Copy, Clone)]
enum RecordingTarget {
    Sequence(RefDataValue),
    Unhandled,
}

impl BunTest {
    fn init(
        preload: Rc<Preload>,
        generation: u32,
        file: File,
        reporter: &'static CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) -> Self {
        let _g = group_begin!();

        let root = BaseScope::init(BaseScopeCfg::default(), None, Some(&preload.scope), false);
        root.only.set(if reporter.jest.only { Only::Contains } else { Only::No });
        let scopes = SmallLocalVec::new();
        scopes.push(DescribeScope::create(ScopeId::ROOT, root, Default::default()));

        BunTest {
            in_run_loop: Cell::new(false),
            phase: Cell::new(Phase::Collection),
            file,
            generation,
            collection: Collection::init(),
            execution: Execution::Execution::init(),
            reporter,
            result_queue: Cell::default(),
            default_concurrent,
            first_last,
            preload,
            scopes,
            entries: SmallLocalVec::new(),
            sequence_entries: SmallLocalVec::new(),
            // `EventLoopTimer` has no `Default`; `init_paused` sets
            // `next = EPOCH, state = PENDING`.
            timer: OwnedTimer::init_paused(EventLoopTimerTag::BunTest),
            wants_wakeup: Cell::new(false),
            pending_phase: Cell::new(RefDataValue::Start),
            is_reporting_uncaught: Cell::new(false),
            recording_target: Cell::new(None),
            unhandled_failure: Cell::new(None),
            is_loading: Cell::new(true),
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
        let entries = if id.0.get() & EntryId::PRELOAD_BIT != 0 { &self.preload.entries } else { &self.entries };
        entries.get((id.0.get() - 1) & !EntryId::PRELOAD_BIT)
    }

    pub(crate) fn sequence_entry(&self, id: SequenceEntryId) -> &SequenceEntry {
        self.sequence_entries.get(id.0.get() - 1)
    }

    pub(crate) fn entry_of(&self, id: SequenceEntryId) -> &ExecutionEntry {
        self.entry(self.sequence_entry(id).entry)
    }

    /// `innermost` and the scopes around it, up to the unnamed scopes of the file and of the preload scripts.
    pub(crate) fn scopes_from(&self, innermost: Option<ScopeId>) -> ScopeChain<'_> {
        ScopeChain { buntest: self, next: innermost }
    }

    /// `first` and the entries that follow it.
    pub(crate) fn sequence_entries_from(
        &self,
        first: Option<SequenceEntryId>,
    ) -> impl Iterator<Item = (SequenceEntryId, &SequenceEntry)> {
        let mut next = first;
        core::iter::from_fn(move || {
            let id = next?;
            let sequence_entry = self.sequence_entry(id);
            next = sequence_entry.next.get();
            Some((id, sequence_entry))
        })
    }

    pub(crate) fn active_scope(&self) -> &DescribeScope {
        self.scope(self.collection.active_scope.get())
    }

    pub(crate) fn push_sequence_entry(&self, entry: EntryId) -> SequenceEntryId {
        SequenceEntryId(NonZeroU32::MIN.saturating_add(self.sequence_entries.push(SequenceEntry {
            entry,
            next: Cell::new(None),
            failure_skip_past: Cell::new(None),
            timespec: Cell::new(Timespec::EPOCH),
        })))
    }

    /// For a new `ExecutionEntry` that is in no scope.
    pub(crate) fn create_sequence_entry(
        &self,
        callback: Option<JSValue>,
        cfg: ExecutionEntryCfg,
        phase: AddedInPhase,
    ) -> SequenceEntryId {
        let entry = ExecutionEntry::create(None, callback, cfg, None, None, BaseScopeCfg::default(), phase);
        self.push_sequence_entry(entry.push_to(&self.entries))
    }

    fn link_after(&self, previous: SequenceEntryId, entry: SequenceEntryId) {
        self.sequence_entry(entry).next.set(self.sequence_entry(previous).next.replace(Some(entry)));
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
            self.create_sequence_entry(None, cfg, AddedInPhase::Collection)
        });
    }

    pub(crate) fn defer_to_file_end(&self, callback: JSValue, timeout: u32) -> bool {
        let Some(&file_end) = self.file_end.get() else {
            return false;
        };
        // `file_end`'s group is always the last one.
        if self.phase.get() != Phase::Execution || self.execution.group_index.get() + 1 >= self.execution.groups().len() {
            return false;
        }
        let entry = self.create_vitest_entry(callback, timeout);
        self.sequence_entry(entry).failure_skip_past.set(Some(entry));
        self.link_after(file_end, entry);
        true
    }

    pub(crate) fn create_vitest_entry(&self, callback: JSValue, timeout: u32) -> SequenceEntryId {
        let cfg = ExecutionEntryCfg { timeout, calling: Calling::Vitest { context: false }, ..Default::default() };
        self.create_sequence_entry(Some(callback), cfg, AddedInPhase::Execution)
    }

    pub(crate) fn get_current_state_data(&self) -> RefDataValue {
        match self.phase.get() {
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

    pub(crate) fn ref_(this: &BunTestPtr, phase: RefDataValue) -> RefPtr<RefData> {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "ref: {}", phase);

        RefPtr::new(RefData {
            buntest_weak: Rc::downgrade(this),
            phase,
            timed_out: Cell::new(false),
            ref_count: bun_ptr::RefCount::init(),
        })
    }

    fn bun_test_then_or_catch(
        global_this: &JSGlobalObject,
        result: JSValue,
        key: *const RefData,
        is_catch: bool,
    ) -> JsResult<()> {
        let _g = group_begin!();

        let Some(refdata) = Jest::runner().and_then(|runner| runner.bun_test_root.take_pending_then_ref(key)) else {
            return Ok(());
        };
        let has_one_ref = refdata.has_one_ref();
        let Some(this) = refdata.buntest_weak.upgrade() else {
            bun_core::scoped_log!(bun_test_group, "bunTestThenOrCatch -> the BunTest is no longer active");
            return Ok(());
        };

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
        if let Some(this) = clone_active_strong() {
            let entry = &done.entry;
            let is_running_test = done
                .running_sequence(&this)
                .is_some_and(|sequence| sequence.active_entry.get() == sequence.test_entry);
            if is_running_test {
                this.on_uncaught_exception(global_this, Some(error), false, entry);
                // As for any other uncaught exception: the test is over whatever its callback returns,
                // and `on_before_exit()` doesn't drain the event loop of a file that failed.
                this.add_result(*entry);
                Self::run_next_tick(&Rc::downgrade(&this), global_this, *entry);
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
        strong.add_result(ref_in.phase);
        Self::run_next_tick(&ref_in.buntest_weak, global_this, ref_in.phase);

        Ok(())
    }

    fn handle_timeout(&self, global_this: &JSGlobalObject) {
        let _g = group_begin!();
        Execution::Execution::kill_dangling_processes_on_timeout(self, global_this);
        self.add_result(RefDataValue::Start);
    }

    pub(crate) fn bun_test_timeout_callback(
        this: &BunTestPtr,
        _ts: &Timespec,
        vm: &VirtualMachine,
    ) {
        let _g = group_begin!();
        let global = vm.global();
        this.timer.next.set(Timespec::EPOCH);
        this.timer.state.set(EventLoopTimerState::PENDING);

        match this.phase.get() {
            Phase::Collection => {}
            Phase::Execution => this.handle_timeout(global),
            Phase::Done => {}
        }
        // Not run inline, because `Bun.spawnSync()` can fire this timer with the timed-out test still on the stack.
        Self::run_next_tick(&Rc::downgrade(this), global, RefDataValue::Done);
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
        strong.wants_wakeup.set(true);
        strong.pending_phase.set(phase);
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
        let phase = strong.pending_phase.get();
        // After a termination the exception is still pending, and the caller's next drain reports it.
        let _ = Box::new(RunTestsTask {
            weak: Rc::downgrade(&strong),
            global_this: GlobalRef::from(global_this),
            phase,
        })
        .call();
    }

    pub(crate) fn add_result(&self, result: RefDataValue) {
        self.result_queue.with_taken(|queue| queue.push_back(result));
    }

    pub(crate) fn has_queued_results(&self) -> bool {
        self.result_queue.with_taken(|queue| !queue.is_empty())
    }

    pub(crate) fn run(this: &BunTestPtr, global_this: &JSGlobalObject) -> JsResult<()> {
        let _g = group_begin!();

        if this.in_run_loop.replace(true) {
            return Ok(());
        }
        scopeguard::defer! { this.in_run_loop.set(false) }

        let mut min_timeout = Timespec::EPOCH;

        while let Some(result) = this.result_queue.with_taken(VecDeque::pop_front) {
            global_this.clear_termination_exception();
            let step_result: StepResult = match this.phase.get() {
                Phase::Collection => Collection::step(this, global_this, &result)?,
                Phase::Execution => Execution::Execution::step(this, global_this, &result)?,
                Phase::Done => StepResult::Complete,
            };
            match step_result {
                StepResult::Waiting { timeout } => {
                    min_timeout = min_timeout.min_ignore_epoch(timeout);
                }
                StepResult::Complete => {
                    if this.advance(global_this)? == Advance::Exit {
                        return Ok(());
                    }
                    this.add_result(RefDataValue::Start);
                }
            }
        }

        Self::update_min_timeout(this, &min_timeout);
        Ok(())
    }

    fn update_min_timeout(this: &BunTestPtr, min_timeout: &Timespec) {
        let _g = group_begin!();
        let timer: &EventLoopTimer = &this.timer;
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

    fn advance(&self, _global_this: &JSGlobalObject) -> JsResult<Advance> {
        let _g = group_begin!();
        bun_core::scoped_log!(bun_test_group, "advance from {}", <&'static str>::from(self.phase.get()));
        let result = self.advance_inner();
        bun_core::scoped_log!(bun_test_group, "advance -> {}", <&'static str>::from(self.phase.get()));
        result
    }

    fn advance_inner(&self) -> JsResult<Advance> {
        match self.phase.get() {
            Phase::Collection => {
                self.phase.set(Phase::Execution);
                debug::dump_describe(self, self.scope(ScopeId::ROOT))?;

                let jest = &self.reporter.jest;
                // Derive a per-file shuffle seed from (seed, file_path) so a
                // file's test order depends only on the path and the printed
                // seed — not on which worker ran it or what files preceded it
                // on that worker. This is what makes --parallel --randomize
                // reproducible via --seed=N.
                // Basename only: path separators and absolute prefixes differ on Windows.
                let seed = bun_wyhash::hash(bun_paths::basename(self.file.path)).wrapping_add(u64::from(jest.seed));

                let mut order = Order::Order::init(self, Order::Config {
                    always_use_hooks: self.scope(ScopeId::ROOT).base.only.get() == Only::No && jest.filter_regex.is_none(),
                    randomize: jest.randomize.then(|| bun_core::rand::DefaultPrng::init(seed)),
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

                if order.shuffled {
                    self.reporter.update_summary(|summary| summary.shuffled += 1);
                }
                self.execution.load_from_order(order);
                debug::dump_order(self)?;
                Ok(Advance::Cont)
            }
            Phase::Execution => {
                self.phase.set(Phase::Done);
                Ok(Advance::Exit)
            }
            Phase::Done => Ok(Advance::Exit),
        }
    }

    /// if sync, the result is returned. if async, None is returned.
    #[optimize(size)]
    pub(crate) fn run_test_callback(
        this: &BunTestPtr,
        global_this: &JSGlobalObject,
        cfg_callback: JSValue,
        cfg_args: &[JSValue],
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
            bun_core::scoped_log!(bun_test_group, "callTestCallback -> appending done callback param: data {}", cfg_data);
            done_callback = DoneCallback::create_unbound(global_this, cfg_data, this.generation);
            done_arg = match DoneCallback::bind(done_callback, global_this) {
                Ok(v) => v,
                Err(e) => {
                    this.on_uncaught_exception(global_this, Some(global_this.take_exception(e)), false, &cfg_data);
                    JSValue::ZERO // failed to bind done callback
                }
            };
        }

        // An exception left pending by earlier code would make this call fail, so report it first.
        if global_this.has_exception() {
            global_this.clear_termination_exception();
            this.on_uncaught_exception(global_this, global_this.try_take_exception(), false, &RefDataValue::Start);
        }

        Self::update_min_timeout(this, timeout);
        let args_slice: &[JSValue] = if !done_arg.is_empty() { core::slice::from_ref(&done_arg) } else { cfg_args };
        let on_stack = OnStack::enter(&this.execution.on_stack, &cfg_data);
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
                this.on_uncaught_exception(global_this, global_this.try_take_exception(), false, &cfg_data);
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

        let mut uncalled_done: Option<&DoneCallback> = None;
        if !done_callback.is_empty() && !result.is_empty() {
            if let Some(dcb_data) = done_callback.as_class_ref::<DoneCallback>() {
                if dcb_data.called.get() {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    dcb_data.r#ref.set(Some(Self::ref_(this, cfg_data)));
                    uncalled_done = Some(dcb_data);
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
                        let this_ref: RefPtr<RefData> = uncalled_done
                            .and_then(|done| done.r#ref.with_taken(|r#ref| r#ref.clone()))
                            .unwrap_or_else(|| Self::ref_(this, cfg_data));
                        let key = this_ref.as_ptr();
                        let root = &this.reporter.jest.bun_test_root;
                        root.pending_then_refs.with_taken(|pending_then_refs| pending_then_refs.push(this_ref));
                        let _ = result.then(
                            global_this,
                            key,
                            Bun__TestScope__Describe2__bunTestThen,
                            Bun__TestScope__Describe2__bunTestCatch,
                        );
                        // TODO: properly propagate exception upwards
                        return None;
                    }
                    PromiseStatus::Fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        let value = bun_jsc::JSPromise::opaque_mut(promise).result(global_this.vm());
                        this.adopt_teardown(&cfg_data, value);
                        return Some(cfg_data);
                    }
                    PromiseStatus::Rejected => {
                        let value = bun_jsc::JSPromise::opaque_mut(promise).result(global_this.vm());
                        this.on_uncaught_exception(global_this, Some(value), true, &cfg_data);

                        // We previously marked it as handled above.

                        return Some(cfg_data);
                    }
                }
            }
        }

        if uncalled_done.is_some() {
            // completed asynchronously
            bun_core::scoped_log!(bun_test_group, "callTestCallback -> wait for done callback");
            return None;
        }

        bun_core::scoped_log!(bun_test_group, "callTestCallback -> sync");
        if !result.is_empty() {
            this.adopt_teardown(&cfg_data, result);
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
        let Some(active_entry) = sequence.active_entry.get() else {
            return;
        };
        let hook = self.entry_of(active_entry);
        if !hook.calling.is_vitest() {
            return;
        }
        if sequence.test_entry.is_none() {
            if let (Some(slot), None) = (hook.teardown, hook.around) {
                self.entry(slot).callback.set(strong_create(returned));
            }
        } else if sequence.test_follows(self, active_entry) {
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
        &self,
        global_this: &JSGlobalObject,
        exception: Option<JSValue>,
        is_rejection: bool,
        user_data: &RefDataValue,
    ) {
        let _g = group_begin!();

        let _ = is_rejection;

        let handle_status: HandleUncaughtExceptionResult = match self.phase.get() {
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

        if let (Phase::Execution, Some(thrown)) = (self.phase.get(), exception)
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

        let recording_target = if !self.reporter.jest.reports_to_junit {
            None
        } else if handle_status == HandleUncaughtExceptionResult::ShowHandledError {
            Some(RecordingTarget::Sequence(*user_data))
        } else {
            Some(RecordingTarget::Unhandled)
        };

        self.reporter.jest.bun_test_root.on_before_print();
        if matches!(
            handle_status,
            HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests
                | HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe
        ) {
            self.reporter.jest.unhandled_errors_between_tests.update(|errors| errors + 1);
            bun_core::pretty_errorln!(
                "<r>\n<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>\n<d>-------------------------------<r>\n",
            );
            Output::flush();
        }

        // A getter of `exception` can report another error while this one is printed.
        let outer_target = self.recording_target.replace(recording_target);
        let outer_failure = self.unhandled_failure.take();
        print_error(global_this.bun_vm(), global_this, exception, None);
        if let Some(slot) = self.recording_slot() {
            slot.with_taken(|slot| {
                TestFailure::record_log_message(slot, exception);
                if let Some(failure) = slot
                    && handle_status == HandleUncaughtExceptionResult::ShowHandledError
                {
                    failure.uncaught |= self.is_reporting_uncaught.get();
                }
            });
        }
        self.recording_target.set(outer_target);
        if let Some(failure) = self.unhandled_failure.replace(outer_failure) {
            self.reporter.record_unhandled_error(self.file.path, failure);
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

    fn recording_slot(&self) -> Option<&Cell<Option<TestFailure>>> {
        match self.recording_target.get()? {
            RecordingTarget::Sequence(data) => Some(&data.sequence(self)?.failure),
            RecordingTarget::Unhandled => Some(&self.unhandled_failure),
        }
    }

    /// `VirtualMachine::on_print_error_zig_exception`
    #[optimize(size)]
    pub(crate) fn record_printed_error(exception: &jsc::ZigException<'_>) {
        if let Some(this) = clone_active_strong()
            && let Some(slot) = this.recording_slot()
        {
            slot.with_taken(|slot| TestFailure::record(slot, exception));
        }
    }
}

struct OnStack<'a> {
    cell: &'a Cell<Option<EntryData>>,
    outer: Option<EntryData>,
}

impl<'a> OnStack<'a> {
    fn enter(cell: &'a Cell<Option<EntryData>>, data: &RefDataValue) -> OnStack<'a> {
        let entry = match *data {
            RefDataValue::Execution { entry_data, .. } => entry_data,
            _ => None,
        };
        OnStack { cell, outer: cell.replace(entry) }
    }
}

impl Drop for OnStack<'_> {
    fn drop(&mut self) {
        self.cell.set(self.outer);
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
    pub(crate) entry: Option<SequenceEntryId>,
    pub(crate) attempt: u32,
}

/// Holds ids into one `BunTest`.
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

    pub(crate) fn entry(&self, buntest: &BunTest) -> Option<SequenceEntryId> {
        if !matches!(self, RefDataValue::Execution { .. }) {
            return None;
        }
        if buntest.phase.get() != Phase::Execution {
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
    pub(crate) timed_out: Cell<bool>,
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
        if this.global_this.vm().is_entered() || strong.is_loading.get() {
            return Ok(());
        }
        if let Err(e) = BunTest::run(&strong, &this.global_this) {
            // A termination is the tick's to fold, not a test failure.
            if this.global_this.has_pending_termination_exception() {
                return Err(e);
            }
            strong.on_uncaught_exception(
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
    fn entries_mut(&mut self, tag: HookTag) -> &mut Vec<EntryId> {
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

    /// `entries`: `Preload::entries` for the preload scope, else `BunTest::entries`.
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
            HookTag::AfterEach | HookTag::AfterAll if is_vitest => hooks.entries_mut(tag).insert(0, entry),
            HookTag::AfterAll => hooks.after_all.insert(first_teardown_slot, entry),
            _ => hooks.entries_mut(tag).push(entry),
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
        let preload_bit = if self.added_in_phase == AddedInPhase::Preload { EntryId::PRELOAD_BIT } else { 0 };
        EntryId(NonZeroU32::MIN.saturating_add(entries.push(self)) | preload_bit)
    }
}

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

