use core::fmt;
use std::cell::{Cell, UnsafeCell};
use std::rc::{Rc, Weak};

use bun_alloc::AllocationScope;
use bun_collections::LinearFifo;
use bun_core::{Output, Timespec};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::js_promise::Status as PromiseStatus;
use super::jest::{Jest, TestRunner, FileId};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::cli::test_command::{self, CommandLineReporter};

bun_core::declare_scope!(bun_test_group, hidden);
// `group` in the Zig is `debug.group` (an Output.scoped). The macro form differs;
// callers use `group_log!` / `group_begin!` / `group_end!` below.
/// Thin macro over `debug::group::begin(file, line, col, fn_name)` so call
/// sites stay `group_begin!()` (Zig: `group.begin(@src())`).
macro_rules! group_begin {
    () => {
        $crate::test_runner::debug::group::begin(file!(), line!(), column!(), "")
    };
}
pub(crate) use group_begin;

pub fn clone_active_strong() -> Option<BunTestPtr> {
    let runner = Jest::runner()?;
    runner.bun_test_root.clone_active_file()
}

pub use super::done_callback::DoneCallback;

pub mod js_fns {
    use super::*;

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
        // SAFETY: bun_vm() returns the live per-thread VM; deref for a single field read.
        if unsafe { (*vm).is_in_preload } && !cfg.allow_in_preload {
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
    // PORT NOTE: was a const-generic param (`adt_const_params` is unstable);
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
    // PORT NOTE: reshaped — `adt_const_params` is unstable, so the body takes
    // `tag` at runtime and 5 thin `#[host_fn]` wrappers below supply the
    // per-tag entry points (one fn per JS function, matching Zig's comptime
    // monomorphization for JSFunction::create).
    pub fn generic_hook_impl(
        tag: GenericHookTag,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        {
            group_begin!();
            let _g = scopeguard::guard((), |_| debug::group::end());
            // errdefer group.log("ended in error", .{}) — handled by ? paths implicitly logging
            // TODO(port): errdefer side-effect log on error path

            let tag_name: &'static str = tag.into();
            let sig_bytes: &'static [u8] = tag.sig();

            let mut args = ScopeFunctions::parse_arguments(
                global_this,
                call_frame,
                Signature::Str(sig_bytes),
                ScopeFunctions::ParseArgumentsCfg { callback: ScopeFunctions::CallbackMode::Require, kind: ScopeFunctions::FunctionKind::Hook },
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
                if tag == GenericHookTag::OnTestFinished {
                    return Err(global_this.throw(format_args!(
                        "Cannot call {}() in preload. It can only be called inside a test.",
                        tag_name
                    )));
                }
                bun_core::scoped_log!(bun_test_group, "genericHook in preload");

                let _ = bun_test_root.hook_scope.append_hook(
                    tag.as_hook_tag().unwrap(),
                    args.callback,
                    cfg,
                    BaseScopeCfg::default(),
                    AddedInPhase::Preload,
                )?;
                return Ok(JSValue::UNDEFINED);
            };

            match bun_test.phase {
                Phase::Collection => {
                    if tag == GenericHookTag::OnTestFinished {
                        return Err(global_this.throw(format_args!(
                            "Cannot call {}() outside of a test. It can only be called inside a test.",
                            tag_name
                        )));
                    }
                    let _ = bun_test.collection.active_scope.append_hook(
                        tag.as_hook_tag().unwrap(),
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

                    let append_point: *mut ExecutionEntry = match tag {
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

    /// Per-tag `#[host_fn]` entry points (one fn per JS function so
    /// `JSFunction::create` gets a distinct address). Replaces Zig's
    /// `genericHook(comptime tag).hookFn` type-generator.
    pub mod generic_hook {
        use super::*;
        macro_rules! hook {
            ($name:ident, $tag:ident) => {
                #[bun_jsc::host_fn]
                pub fn $name(
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
/// Compat alias for sibling drafts (jest.rs) that referenced `bun_test::HookKind`.
pub use js_fns::GenericHookTag as HookKind;

/// `bun.ptr.shared.WithOptions(*BunTest, .{ .allow_weak = true, .Allocator = bun.DefaultAllocator })`
/// → `Rc<BunTestCell>` (single-thread, weak-capable, interior-mutable).
///
/// Zig's `BunTestPtr.get()` hands back a freely-aliasing `*BunTest`; the Rust
/// port mutates through this handle pervasively (re-entrantly via JS callbacks).
/// `Rc<T>` does **not** wrap `T` in `UnsafeCell`, so the previous
/// `Rc::as_ptr(&rc) as *mut T` + write was UB. The payload now lives in an
/// explicit `UnsafeCell` so all writes go through interior-mutable provenance.
pub type BunTestPtr = Rc<BunTestCell>;
pub type BunTestPtrWeak = Weak<BunTestCell>;
pub type BunTestPtrOptional = Option<Rc<BunTestCell>>;

/// `UnsafeCell` newtype so `Rc<BunTestCell>` permits mutation of the shared
/// `BunTest` (Zig: `*BunTest` aliases freely; Rust requires `UnsafeCell` for
/// any write reachable through a shared/`*const` path).
#[repr(transparent)]
pub struct BunTestCell(UnsafeCell<BunTest<'static>>);

impl BunTestCell {
    #[inline]
    pub fn new(bt: BunTest<'static>) -> Rc<Self> {
        Rc::new(Self(UnsafeCell::new(bt)))
    }

    /// Zig `BunTestPtr.get()` → `*BunTest`.
    ///
    /// Returns `&mut` because every call site mutates. The borrow is derived
    /// from `UnsafeCell::get()` so provenance is valid for writes even while
    /// other `Rc`/`Weak` handles exist.
    ///
    /// **Aliasing contract:** the test runner is single-threaded and this is
    /// the moral equivalent of Zig's freely-aliasing `*T`. Callers must not
    /// hold the returned `&mut` across a re-entrancy point (JS callback,
    /// `Collection::step`, `Execution::step`, `BunTest::run`) that itself calls
    /// `.get()` — re-derive afterwards instead. Prefer [`as_ptr`](Self::as_ptr)
    /// for long-lived handles that span re-entrant calls.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get(&self) -> &mut BunTest<'static> {
        // SAFETY: `UnsafeCell` interior; single-threaded JS VM. See contract above.
        unsafe { &mut *self.0.get() }
    }

    /// Raw pointer for sites that must span re-entrant `.get()` calls without
    /// holding a live `&mut` (Stacked-Borrows-safe: raw ptrs do not assert
    /// uniqueness).
    #[inline]
    pub fn as_ptr(&self) -> *mut BunTest<'static> {
        self.0.get()
    }
}

impl core::ops::Deref for BunTestCell {
    type Target = BunTest<'static>;
    #[inline]
    fn deref(&self) -> &BunTest<'static> {
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
pub unsafe fn buntest_as_mut(ptr: &BunTestPtr) -> &mut BunTest<'static> {
    ptr.get()
}

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
        file_id: FileId,
        reporter: &mut CommandLineReporter,
        default_concurrent: bool,
        first_last: FirstLast,
    ) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());

        debug_assert!(self.active_file.is_none());

        // Derive the stored backref from the TestRunner's *stable* storage
        // (the global `Jest::RUNNER` NonNull) rather than `self as *mut _`.
        // A pointer coerced from `&mut self` carries provenance bounded by this
        // call's reborrow; the next `Jest::runner()` hands out a fresh
        // `&'static mut TestRunner`, invalidating that tag, so later derefs at
        // `BunTest::run`/`on_uncaught_exception` would be use-after-invalidation
        // under Stacked Borrows. Zig (.zig:178) just passes a stable `*BunTestRoot`.
        // SAFETY: single-threaded; `RUNNER` outlives every BunTest. Field
        // projection via `addr_of_mut!` creates no intermediate `&mut TestRunner`.
        let stable_root: *mut BunTestRoot = Jest::runner_ptr()
            .map(|p| unsafe { core::ptr::addr_of_mut!((*p.as_ptr()).bun_test_root) })
            .unwrap_or(self as *mut BunTestRoot);

        // Zig: active_file = .new(undefined); active_file.get().?.init(...)
        // TODO(port): in-place init — Rc::new_cyclic or two-phase init may be
        // needed because BunTest stores a backref to BunTestRoot.
        let bun_test = BunTestCell::new(BunTest::init(
            stable_root,
            file_id,
            Some(reporter),
            default_concurrent,
            first_last,
        ));
        self.active_file = Some(bun_test);
    }

    pub fn exit_file(&mut self) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());

        debug_assert!(self.active_file.is_some());
        if let Some(active) = &self.active_file {
            // SAFETY: single-threaded; no other `&mut BunTest` is live during
            // teardown. Write goes through `UnsafeCell` (see `BunTestCell::get`).
            active.get().reporter = None;
        }
        self.active_file = None; // drops the Rc (deinit)
    }

    pub fn get_active_file_unless_in_preload(&mut self, vm: *mut VirtualMachine) -> Option<&mut BunTest<'static>> {
        // SAFETY: vm is the live per-thread VM (from `JSGlobalObject::bun_vm()`).
        if unsafe { (*vm).is_in_preload } {
            return None;
        }
        // SAFETY: single-threaded; caller (js_fns::generic_hook) holds the only
        // live `&mut` for the duration of the hook-append below. Projection goes
        // through `UnsafeCell` (see `BunTestCell::get`).
        self.active_file.as_ref().map(|rc| rc.get())
    }

    pub fn clone_active_file(&self) -> Option<BunTestPtr> {
        self.active_file.clone()
    }

    pub fn on_before_print(&self) {
        if let Some(active_file) = &self.active_file {
            // Do NOT go through `<BunTestCell as Deref>` here. Two of the three
            // callers (`on_uncaught_exception`, test_command.rs report-status)
            // reach this while a `&mut BunTest` to the *same* cell payload is
            // live and reused afterward; materialising a sibling `&BunTest`
            // would pop the caller's Unique tag under Stacked Borrows. Read the
            // reporter field via raw ptr instead — `Option<&_>` is `Copy`.
            // SAFETY: single-threaded; `active_file` keeps the cell alive; raw
            // field read creates no intermediate `&BunTest`.
            let reporter = unsafe { *core::ptr::addr_of!((*active_file.as_ptr()).reporter) };
            if let Some(reporter) = reporter {
                // `last_printed_dot` is `Cell<bool>` so the `&CommandLineReporter` borrow
                // suffices — no `&mut` materialized through a shared ref (Zig used `*T`).
                if reporter.reporters.dots && reporter.last_printed_dot.get() {
                    bun_core::pretty_error!("<r>\n");
                    Output::flush();
                    reporter.last_printed_dot.set(false);
                }
                // `Jest::runner()` would hand out `&'static mut TestRunner` while
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
    pub bun_test_root: *mut BunTestRoot,
    pub in_run_loop: bool,
    pub allocation_scope: AllocationScope,
    // gpa / arena_allocator / arena dropped — see §Allocators (non-AST crate)
    // PERF(port): was arena bulk-free for per-file scratch
    pub file_id: FileId,
    /// null if the runner has moved on to the next file but a strong reference to BunTest is still keeping it alive
    pub reporter: Option<&'a CommandLineReporter>,
    // PORT NOTE: Zig stores `?*CommandLineReporter`; the only field mutated through this
    // shared borrow is `last_printed_dot`, now `Cell<bool>` for sound interior mutability.
    pub timer: EventLoopTimer,
    pub result_queue: ResultQueue,
    /// Whether tests in this file should default to concurrent execution
    pub default_concurrent: bool,
    pub first_last: FirstLast,
    pub extra_execution_entries: Vec<*mut ExecutionEntry>,
    pub wants_wakeup: bool,

    pub phase: Phase,
    pub collection: Collection,
    pub execution: Execution::Execution,
}

impl<'a> BunTest<'a> {
    pub fn init(
        bun_test_root: *mut BunTestRoot,
        file_id: FileId,
        reporter: Option<&'a CommandLineReporter>,
        default_concurrent: bool,
        first_last: FirstLast,
    ) -> Self {
        group_begin!();
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
            execution: Execution::Execution::init(),
            reporter,
            result_queue: ResultQueue::new(),
            default_concurrent,
            first_last,
            extra_execution_entries: Vec::new(),
            timer: EventLoopTimer { next: Timespec::EPOCH, tag: EventLoopTimerTag::BunTest, ..Default::default() },
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
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        bun_core::scoped_log!(bun_test_group, "ref: {}", phase);

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
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // TODO(port): errdefer group.log("ended in error")

        let [result, this_ptr] = callframe.arguments_as_array::<2>();
        if this_ptr.is_empty_or_undefined_or_null() {
            return Ok(());
        }

        // SAFETY: this_ptr was created by wrapping a RefDataPtr via asPromisePtr; we adopt the +1 it carried
        let refdata: RefDataPtr = unsafe { bun_ptr::IntrusiveRc::from_raw(this_ptr.as_promise_ptr::<RefData>()) };
        // defer refdata.deref() — RefPtr<T> currently has NO Drop impl (src/ptr/ref_count.rs),
        // so scope-exit drop is a silent no-op. Decrement the intrusive count explicitly so
        // (a) RefData::destructor frees the box + Weak<BunTest>, and (b) a paired done() callback
        // observes has_one_ref()==true on its turn instead of hanging.
        let refdata = scopeguard::guard(refdata, |r| bun_ptr::IntrusiveRc::deref(&r));
        let has_one_ref = refdata.has_one_ref();
        let Some(this_strong) = refdata.buntest_weak.upgrade() else {
            bun_core::scoped_log!(bun_test_group, "bunTestThenOrCatch -> the BunTest is no longer active");
            return Ok(());
        };
        // SAFETY: `&mut` derived via `UnsafeCell`; not held across `run_next_tick`
        // (which itself calls `.get()` for a single field write).
        let this = this_strong.get();

        if is_catch {
            this.on_uncaught_exception(global_this, Some(result), true, refdata.phase.clone());
        }
        if !has_one_ref && !is_catch {
            bun_core::scoped_log!(bun_test_group, "bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref");
            return Ok(());
        }

        this.add_result(refdata.phase.clone());
        // `this` borrow ends here (NLL); `run_next_tick` re-derives via `.get()`.
        Self::run_next_tick(&refdata.buntest_weak, global_this, refdata.phase.clone());
        Ok(())
    }

    // PORT NOTE: `#[bun_jsc::host_fn]` proc-macro emits a free-fn wrapper that
    // calls the annotated item by bare name; that lookup fails for associated
    // fns inside `impl` blocks. The extern-"C" trampoline is wired separately
    // (see the gated `Bun__TestScope__Describe2__*` statics below), so the
    // attribute is dropped here — these are plain JsResult fns.
    fn bun_test_then(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::bun_test_then_or_catch(global_this, callframe, false)?;
        Ok(JSValue::UNDEFINED)
    }

    fn bun_test_catch(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::bun_test_then_or_catch(global_this, callframe, true)?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn bun_test_done_callback(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        group_begin!();
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
        // defer ref_in.deref() — RefPtr<T> currently has NO Drop impl, so decrement the
        // intrusive count explicitly at scope exit (mirrors .zig:472). Without this the
        // paired promise then/catch path never sees has_one_ref()==true and the RefData leaks.
        let ref_in = scopeguard::guard(ref_in, |r| bun_ptr::IntrusiveRc::deref(&r));

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
        // SAFETY: `&mut` derived via `UnsafeCell`; borrow ends before
        // `run_next_tick` re-derives.
        strong.get().add_result(ref_in.phase.clone());
        Self::run_next_tick(&ref_in.buntest_weak, global_this, ref_in.phase.clone());

        Ok(JSValue::UNDEFINED)
    }

    pub fn bun_test_timeout_callback(
        this_strong: BunTestPtr,
        _ts: &Timespec,
        vm: &VirtualMachine,
    ) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // Raw `*mut` (via `UnsafeCell`) because `Self::run` below re-enters and
        // calls `.get()` on the same `Rc` — holding a long-lived `&mut` across
        // that would alias. Each `(*this).x` is a fresh short-lived reborrow.
        let this: *mut BunTest = this_strong.as_ptr();
        // SAFETY: `this` derived from `UnsafeCell::get`; single-threaded; each
        // deref is a point-use that does not span a re-entrant `.get()`.
        unsafe {
            (*this).timer.next = Timespec::EPOCH;
            (*this).timer.state = EventLoopTimerState::Pending;

            match (*this).phase {
                Phase::Collection => {}
                Phase::Execution => {
                    if let Err(e) = (*this).execution.handle_timeout(vm.global) {
                        (*this).on_uncaught_exception(vm.global, Some(vm.global.take_exception(e)), false, RefDataValue::Done);
                    }
                }
                Phase::Done => {}
            }
        }
        if let Err(e) = Self::run(this_strong.clone(), vm.global) {
            // SAFETY: re-derive after `run` returned; no `&mut` was held across it.
            unsafe { (*this).on_uncaught_exception(vm.global, Some(vm.global.take_exception(e)), false, RefDataValue::Done) };
        }
    }

    pub fn run_next_tick(weak: &BunTestPtrWeak, global_this: &JSGlobalObject, phase: RefDataValue) {
        let done_callback_test = Box::into_raw(Box::new(RunTestsTask {
            weak: weak.clone(),
            global_this,
            phase,
        }));
        // errdefer bun.destroy(done_callback_test) → ManagedTask::run reconstitutes the Box
        // PORT NOTE: `jsc::ManagedTask` re-exports the *module*; struct is `ManagedTask::ManagedTask`.
        let task = jsc::ManagedTask::ManagedTask::new::<RunTestsTask>(done_callback_test, RunTestsTask::call);
        let vm = global_this.bun_vm();
        let Some(strong) = weak.upgrade() else {
            // PORT NOTE: `bun.Environment.ci_assert` → `cfg!(debug_assertions)` (closest analogue;
            // see src/ptr/ref_count.rs / src/collections/baby_list.rs for the same mapping).
            if cfg!(debug_assertions) {
                debug_assert!(false); // shouldn't be calling runNextTick after moving on to the next file
            }
            return; // but just in case
        };
        // SAFETY: single field write through `UnsafeCell`; no other `&mut` live.
        strong.get().wants_wakeup = true;
        // we need to wake up the event loop so autoTick() doesn't wait for 16-100ms because we just enqueued a task
        vm.enqueue_task(task);
    }

    pub fn add_result(&mut self, result: RefDataValue) {
        self.result_queue.write_item(result);
        // PERF(port): was bun.handleOom — Vec/Deque push aborts on OOM
    }

    pub fn run(this_strong: BunTestPtr, global_this: &JSGlobalObject) -> JsResult<()> {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // Zig: `const this = this_strong.get().?` — a freely-aliasing `*BunTest`.
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
        // Zig: `defer this.in_run_loop = false`. The guard captures the raw ptr
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
            let step_result: StepResult = match unsafe { (*this).phase } {
                Phase::Collection => Collection::step(this_strong.clone(), global_this, result)?,
                Phase::Execution => Execution::Execution::step(this_strong.clone(), global_this, result)?,
                Phase::Done => StepResult::Complete,
            };
            match step_result {
                StepResult::Waiting { timeout } => {
                    min_timeout = Timespec::min_ignore_epoch(min_timeout, timeout);
                }
                StepResult::Complete => {
                    // SAFETY: short-lived reborrow; `_advance` does not re-enter `.get()`.
                    if unsafe { (*this)._advance(global_this)? } == Advance::Exit {
                        return Ok(());
                    }
                    unsafe { (*this).add_result(RefDataValue::Start) };
                }
            }
        }

        // SAFETY: loop done; sole `&mut` for the timer update.
        unsafe { (*this).update_min_timeout(global_this, &min_timeout) };
        Ok(())
    }

    fn update_min_timeout(&mut self, global_this: &JSGlobalObject, min_timeout: &Timespec) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        bun_core::scoped_log!(
            bun_test_group,
            "-> timeout: {} {}, {}",
            min_timeout,
            self.timer.next,
            <&'static str>::from(min_timeout.order_ignore_epoch(&self.timer.next))
        );
        if min_timeout.order_ignore_epoch(&self.timer.next) == core::cmp::Ordering::Less {
            bun_core::scoped_log!(bun_test_group, "-> setting timer to {}", min_timeout);
            if !self.timer.next.eql(&Timespec::EPOCH) {
                bun_core::scoped_log!(bun_test_group, "-> removing existing timer");
                global_this.bun_vm().timer.remove(&mut self.timer);
            }
            self.timer.next = *min_timeout;
            if !self.timer.next.eql(&Timespec::EPOCH) {
                bun_core::scoped_log!(bun_test_group, "-> inserting timer");
                global_this.bun_vm().timer.insert(&mut self.timer);
                if debug::group::get_log_enabled() {
                    let duration = self.timer.next.duration(&Timespec::now_force_real_time());
                    bun_core::scoped_log!(bun_test_group, "-> timer duration: {}", duration);
                }
            }
            bun_core::scoped_log!(bun_test_group, "-> timer set");
        }
    }

    fn _advance(&mut self, _global_this: &JSGlobalObject) -> JsResult<Advance> {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        bun_core::scoped_log!(bun_test_group, "advance from {}", <&'static str>::from(self.phase));
        let _g2 = scopeguard::guard((), |_| {
            bun_core::scoped_log!(bun_test_group, "advance -> {}", <&'static str>::from(self.phase));
        });
        // TODO(port): defer captures &self.phase; reshape for borrowck

        match self.phase {
            Phase::Collection => {
                self.phase = Phase::Execution;
                debug::dump_describe(&self.collection.root_scope)?;

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
                let mut per_file_prng: Option<bun_core::rand::DefaultPrng> = if let Some(reporter) = self.reporter {
                    'blk: {
                        let Some(seed) = reporter.jest.randomize_seed else { break 'blk None };
                        let path = reporter.jest.files.items_source()[self.file_id as usize].path.text;
                        // Basename only so the hash is platform-independent (path
                        // separators and absolute prefixes differ on Windows).
                        Some(bun_core::rand::DefaultPrng::init(
                            bun_wyhash::hash(bun_paths::basename(path)).wrapping_add(seed),
                        ))
                    }
                } else {
                    None
                };
                let should_randomize = per_file_prng.as_mut().map(|p| p.random());
                // TODO(port): std.Random / DefaultPrng mapping — confirm bun_core::random API

                let mut order = Order::Order::init(Order::Config {
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
                order.generate_order_describe(&mut self.collection.root_scope)?;
                beforeall_order.set_failure_skip_to(&mut order);
                let afterall_order: Order::AllOrderResult = if self.first_last.last {
                    order.generate_all_order(&root.hook_scope.after_all)?
                } else {
                    Order::AllOrderResult::EMPTY
                };
                afterall_order.set_failure_skip_to(&mut order);

                self.execution.load_from_order(&mut order)?;
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
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
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
            done_callback = DoneCallback::create_unbound(global_this);
            done_arg = match DoneCallback::bind(done_callback, global_this) {
                Ok(v) => v,
                Err(e) => {
                    // SAFETY: `UnsafeCell`-derived; sole `&mut` at this point.
                    unsafe { (*this).on_uncaught_exception(global_this, Some(global_this.take_exception(e)), false, cfg_data.clone()) };
                    JSValue::ZERO // failed to bind done callback
                }
            };
        }

        // SAFETY: `UnsafeCell`-derived; sole `&mut` at this point (before JS re-entry).
        unsafe { (*this).update_min_timeout(global_this, timeout) };
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
                // SAFETY: re-derive after JS callback returned; no outer `&mut` was held across it.
                unsafe { (*this).on_uncaught_exception(global_this, global_this.try_take_exception(), false, cfg_data.clone()) };
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
                    if promise.status() == PromiseStatus::Rejected {
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

                bun_core::scoped_log!(bun_test_group, "callTestCallback -> promise: data {}", cfg_data);

                match promise.status() {
                    PromiseStatus::Pending => {
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
                    PromiseStatus::Fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        return Some(cfg_data);
                    }
                    PromiseStatus::Rejected => {
                        let value = promise.result(global_this.vm());
                        // SAFETY: re-derive via `UnsafeCell` after the JS/microtask
                        // drain above; sole `&mut` at this point.
                        unsafe { (*this).on_uncaught_exception(global_this, Some(value), true, cfg_data.clone()) };

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
    pub fn on_uncaught_exception(
        &mut self,
        global_this: &JSGlobalObject,
        exception: Option<JSValue>,
        is_rejection: bool,
        user_data: RefDataValue,
    ) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());

        let _ = is_rejection;

        let handle_status: HandleUncaughtExceptionResult = match self.phase {
            Phase::Collection => self.collection.handle_uncaught_exception(&user_data),
            Phase::Done => HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests,
            Phase::Execution => self.execution.handle_uncaught_exception(&user_data),
        };

        bun_core::scoped_log!(bun_test_group, "onUncaughtException -> {}", <&'static str>::from(handle_status));

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
            bun_core::pretty_errorln!(
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
            bun_core::pretty_error!("<r><d>-------------------------------<r>\n\n");
        }

        Output::flush();
    }
}

impl<'a> Drop for BunTest<'a> {
    fn drop(&mut self) {
        group_begin!();
        debug::group::end();

        if self.timer.state == EventLoopTimerState::Active {
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
// TODO(b2-blocked): bun_jsc::host_fn::to_js_host_fn is a no-arg stub; the
// `#[bun_jsc::host_fn]` proc-macro already emits the extern-"C" wrapper for
// `bun_test_then`/`bun_test_catch`, but its mangled name isn't stable yet.
// Gate the C++-linked statics until the proc-macro exposes a named symbol.

#[unsafe(no_mangle)]
pub static Bun__TestScope__Describe2__bunTestThen: jsc::host_fn::JSHostFn =
    jsc::host_fn::to_js_host_fn(BunTest::bun_test_then);

#[unsafe(no_mangle)]
pub static Bun__TestScope__Describe2__bunTestCatch: jsc::host_fn::JSHostFn =
    jsc::host_fn::to_js_host_fn(BunTest::bun_test_catch);

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
    pub ref_count: bun_ptr::RefCount<RefData>,
}
// `bun.ptr.RefCount(RefData, "ref_count", #destroy, .{})` — intrusive single-thread refcount.
// `*RefData` crosses FFI (asPromisePtr), so this MUST be `bun_ptr::IntrusiveRc` (= `RefPtr`), never `Rc`.
pub type RefDataPtr = bun_ptr::IntrusiveRc<RefData>;
impl bun_ptr::RefCounted for RefData {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: `this` points to a live RefData; field projection is in-bounds.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        group_begin!();
        let _g = scopeguard::guard((), |_| debug::group::end());
        // SAFETY: refcount hit zero; we own the allocation (boxed by RefPtr::new)
        unsafe {
            bun_core::scoped_log!(bun_test_group, "refData: {}", (*this).phase);
            // buntest_weak.deinit() → Weak::drop
            drop(Box::from_raw(this));
        }
    }
}
impl RefData {
    pub fn has_one_ref(&self) -> bool {
        self.ref_count.has_one_ref()
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
    /// `ManagedTask` callback ABI: `fn(*mut T) -> JsResult<()>`. The pointer
    /// was `Box::into_raw`'d in `run_next_tick`; reconstitute and drop here.
    pub fn call(this: *mut RunTestsTask) -> JsResult<()> {
        // SAFETY: `this` was produced by `Box::into_raw` in `run_next_tick`.
        let this = unsafe { Box::from_raw(this) };
        // defer bun.destroy(this) → Box drops at end of scope
        // defer this.weak.deinit() → Weak drops with Box
        let Some(strong) = this.weak.upgrade() else { return Ok(()) };
        if let Err(e) = BunTest::run(strong.clone(), this.global_this) {
            // SAFETY: `&mut` derived via `UnsafeCell` after `run` returned; sole
            // borrow at this point.
            let bt = strong.get();
            bt.on_uncaught_exception(
                this.global_this,
                Some(this.global_this.take_exception(e)),
                false,
                this.phase.clone(),
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

pub type ResultQueue = LinearFifo<RefDataValue, bun_collections::linear_fifo::DynamicBuffer<RefDataValue>>;
// PORT NOTE: bun.LinearFifo(.Dynamic) → second generic is the buffer strategy.

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

impl ScopeMode {
    /// Port of Zig `@tagName`.
    pub fn tag_name(self) -> &'static str {
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
    /// Port of Zig `@tagName`.
    pub fn tag_name(self) -> &'static str {
        match self {
            Self::No => "no",
            Self::Contains => "contains",
            Self::Yes => "yes",
        }
    }
}

pub struct BaseScope {
    pub parent: Option<*mut DescribeScope>,
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
        parent: Option<*mut DescribeScope>,
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
            // SAFETY: parent backref valid; tree is single-threaded and parent
            // outlives child. `parent` is `*mut` (Zig: `?*DescribeScope`).
            let parent = unsafe { &mut *parent };
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
            target = scope.base.parent;
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
            target = scope.base.parent;
        }
    }

    pub fn append_describe(
        &mut self,
        name_not_owned: Option<&[u8]>,
        base: BaseScopeCfg,
    ) -> JsResult<&mut DescribeScope> {
        let mut child = Self::create(BaseScope::init(base, name_not_owned, Some(self as *mut _), false));
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
        let mut entry = ExecutionEntry::create(name_not_owned, callback, cfg, Some(self as *mut _), base, phase);
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
        let entry = ExecutionEntry::create(None, callback, cfg, Some(self as *mut _), base, phase);
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
        parent: Option<*mut DescribeScope>,
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
            // SAFETY: pointer-identity comparison only — no deref, no provenance laundering.
            let is_test_entry = sequence
                .test_entry
                .map_or(false, |p| core::ptr::eq(p.as_ptr().cast_const(), self));
            sequence.result = if is_test_entry {
                if self.has_done_parameter {
                    Execution::Result::FailBecauseTimeoutWithDoneCallback
                } else {
                    Execution::Result::FailBecauseTimeout
                }
            } else if self.has_done_parameter {
                Execution::Result::FailBecauseHookTimeoutWithDoneCallback
            } else {
                Execution::Result::FailBecauseHookTimeout
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
// PORT NOTE: Zig nested types (`Execution.ConcurrentGroup`, `Order.Cfg`, …) are
// top-level items in the sibling Rust modules. Alias the *modules* under the
// Zig struct names so `Execution::ConcurrentGroup` / `Order::AllOrderResult`
// resolve as module paths without per-reference rewrites.
pub use super::execution as Execution;
pub use super::debug;
pub use super::scope_functions as ScopeFunctions;
pub use super::order as Order;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/bun_test.zig (1072 lines)
//   confidence: medium
//   todos:      22
//   notes:      BunTestPtr=Rc<BunTestCell> (UnsafeCell interior-mut, .get()/.as_ptr() mirror Zig *BunTest); BunTest<'a> reporter borrow is mutated (reshape); RefData uses bun_ptr::IntrusiveRc (crosses FFI via asPromisePtr); intrusive ExecutionEntry list kept raw; group.begin/end mapped to debug::group stubs.
// ──────────────────────────────────────────────────────────────────────────
