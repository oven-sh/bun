//! for the collection phase of test execution where we discover all the test() calls

use core::ptr::NonNull;
#[allow(unused_imports)] use crate::test_runner::expect::{JSValueTestExt, JSGlobalObjectTestExt, make_formatter};

use bun_jsc::{DeprecatedStrong, JSGlobalObject, JSValue, JsResult};
use bun_core::Timespec;

use crate::test_runner::bun_test::{
    self, BunTest, BunTestPtr, BunTestRoot, DescribeScope, HandleUncaughtExceptionResult,
    RefDataValue, StepResult,
};
use crate::test_runner::bun_test::debug::group;
// TODO(port): jsc.Jest.Jest.runner / jsc.ConsoleObject live under bun_jsc::jest / bun_jsc::console_object — verify module paths in Phase B
use crate::test_runner::jest::Jest;
use bun_jsc::console_object::Formatter as ConsoleFormatter;

pub struct Collection {
    /// set to true after collection phase ends
    pub locked: bool,
    pub describe_callback_queue: Vec<QueuedDescribe>,
    pub current_scope_callback_queue: Vec<QueuedDescribe>,
    // The two queues above are self-referential — their `NonNull<DescribeScope>` fields point
    // into the tree rooted at `root_scope`. They are stored as raw `NonNull` (not `&`) so that
    // `active_scope_mut()` may hand out `&mut DescribeScope` to the same nodes without
    // invalidating any live shared-reference tags under Stacked Borrows.

    pub root_scope: Box<DescribeScope>,
    pub active_scope: NonNull<DescribeScope>,

    pub filter_buffer: Vec<u8>,
}

pub struct QueuedDescribe {
    callback: DeprecatedStrong, // jsc.Strong.Deprecated
    /// Raw cursor into `Collection.root_scope`'s tree. Stored as `NonNull` (not `&DescribeScope`)
    /// because `Collection::active_scope_mut()` hands out `&mut` to the same node while these
    /// queue entries are live; a `&` here would be invalidated by that `&mut` (Stacked Borrows).
    /// The pointee is a `Box<DescribeScope>` inside `TestScheduleEntry::Describe`, so its address
    /// is stable for the lifetime of the owning `Collection`.
    active_scope: NonNull<DescribeScope>,
    /// See `active_scope` — same invariants. Derived from the `&mut DescribeScope` returned by
    /// `append_describe`, so it carries write-capable provenance (later assigned to
    /// `Collection.active_scope` and mutated through).
    new_scope: NonNull<DescribeScope>,
}
// Zig `deinit` only called `callback.deinit()`; `Strong: Drop` covers it — no explicit Drop needed.

impl Collection {
    pub fn init(bun_test_root: *mut BunTestRoot) -> Collection {
        let _g = group::begin();
        // SAFETY: caller (BunTest::init) passes a live pointer to its own `bun_test_root` field.
        let bun_test_root = unsafe { &mut *bun_test_root };

        let only = if let Some(runner) = Jest::runner() {
            if runner.only { bun_test::Only::Contains } else { bun_test::Only::No }
        } else {
            bun_test::Only::No
        };

        let mut root_scope = DescribeScope::create(bun_test::BaseScope {
            parent: Some(&raw mut *bun_test_root.hook_scope),
            name: None,
            concurrent: false,
            mode: bun_test::ScopeMode::Normal,
            only,
            has_callback: false,
            test_id_for_debugger: 0,
            line_no: 0,
        });

        let active_scope = NonNull::from(&mut *root_scope);

        Collection {
            locked: false,
            describe_callback_queue: Vec::new(),
            current_scope_callback_queue: Vec::new(),
            root_scope,
            active_scope,
            filter_buffer: Vec::new(),
        }
    }

    // Zig `deinit` freed root_scope, drained both queues calling item.deinit(), and freed
    // filter_buffer. All of that is covered by field Drop (Box, Vec<QueuedDescribe>, Vec<u8>).
    // No explicit `impl Drop for Collection` needed.

    /// Immutable view of the currently-active describe scope.
    ///
    /// SAFETY: `active_scope` is initialized to `root_scope` in `init()` and is only ever
    /// reassigned to nodes inside `root_scope`'s tree (via `append_describe` children or
    /// restored from a `RefDataValue::Collection` snapshot). The tree is owned by
    /// `self.root_scope: Box<_>` and nodes are never freed for the lifetime of `Collection`,
    /// so the pointer is always valid while `self` is.
    #[inline]
    pub fn active_scope(&self) -> &DescribeScope {
        unsafe { self.active_scope.as_ref() }
    }

    /// Mutable view of the currently-active describe scope.
    ///
    /// SAFETY: see `active_scope()` for validity. The returned `&mut` reborrows from `&mut self`,
    /// so borrowck prevents simultaneous access to `self.root_scope` while it is live. The
    /// self-referential queues (`describe_callback_queue` / `current_scope_callback_queue`) hold
    /// only raw `NonNull<DescribeScope>` to the same nodes, never `&DescribeScope`, so creating
    /// this `&mut` does not invalidate any outstanding shared-reference tags. `active_scope` is
    /// always assigned from a `&mut`-derived `NonNull` (root in `init()`, `new_scope` in
    /// `step()`), so it carries write-capable provenance.
    #[inline]
    pub fn active_scope_mut(&mut self) -> &mut DescribeScope {
        unsafe { self.active_scope.as_mut() }
    }

    pub fn enqueue_describe_callback(
        &mut self,
        new_scope: &mut DescribeScope,
        callback: Option<JSValue>,
    ) -> JsResult<()> {
        let _g = group::begin();

        debug_assert!(!self.locked);
        // PORT NOTE: Zig used `bunTest().gpa` for Strong.init; allocator param dropped.

        if let Some(cb) = callback {
            group::log(format_args!(
                "enqueueDescribeCallback / {} / in scope: {}",
                bstr::BStr::new(new_scope.base.name.as_deref().unwrap_or(b"(unnamed)")),
                bstr::BStr::new(self.active_scope().base.name.as_deref().unwrap_or(b"(unnamed)")),
            ));

            // Store raw NonNull cursors (not `&`) so later `active_scope_mut()` calls on the same
            // node do not invalidate them. Both pointees live in `root_scope`'s Box-allocated tree
            // and outlive every QueuedDescribe stored in `self`. `new_scope` is `&mut`, so the
            // resulting NonNull carries write-capable provenance (later assigned to
            // `self.active_scope` in `step()` and mutated through).
            self.current_scope_callback_queue.push(QueuedDescribe {
                active_scope: self.active_scope,
                callback: DeprecatedStrong::init(cb),
                new_scope: NonNull::from(new_scope),
            });
        }
        Ok(())
    }

    pub fn run_one_completed(
        &mut self,
        global_this: &JSGlobalObject,
        _: Option<JSValue>,
        data: RefDataValue,
    ) -> JsResult<()> {
        let _g = group::begin();

        let _formatter = make_formatter(global_this);

        let prev_scope: NonNull<DescribeScope> = match data {
            RefDataValue::Collection { active_scope } => active_scope,
            _ => {
                debug_assert!(false); // this probably can't happen
                self.active_scope
            }
        };

        group::log(format_args!(
            "collection:runOneCompleted reset scope back from {}",
            bstr::BStr::new(self.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));
        self.active_scope = prev_scope;
        group::log(format_args!(
            "collection:runOneCompleted reset scope back to {}",
            bstr::BStr::new(self.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));
        Ok(())
    }

    pub fn step(
        buntest_strong: BunTestPtr,
        global_this: &JSGlobalObject,
        data: RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group::begin();
        let buntest = buntest_strong.get();
        let this = &mut buntest.collection;

        if !matches!(data, RefDataValue::Start) {
            this.run_one_completed(global_this, None, data)?;
        }

        let _formatter = make_formatter(global_this);

        // append queued callbacks, in reverse order because items will be pop()ed from the end
        // PORT NOTE: reshaped for borrowck — Zig indexed `items[i]` then clearRetainingCapacity;
        // drain(..).rev() moves each item out exactly once and leaves capacity intact.
        for item in this.current_scope_callback_queue.drain(..).rev() {
            // SAFETY: `new_scope` points into `root_scope`'s Box-allocated tree, which outlives
            // every queued item; short-lived read, no aliasing `&mut` is live here.
            if unsafe { item.new_scope.as_ref() }.failed {
                // if there was an error in the describe callback, don't run any describe callbacks in this scope
                drop(item); // Zig: item.deinit() — Strong released here
            } else {
                this.describe_callback_queue.push(item);
            }
        }
        // PERF(port): was clearRetainingCapacity — drain(..) retains capacity.

        while !this.describe_callback_queue.is_empty() {
            group::log(format_args!("runOne -> call next"));
            let first = this.describe_callback_queue.pop().unwrap();
            // `defer first.deinit()` — handled by Drop at end of loop body / continue.

            // SAFETY: `active_scope` points into `root_scope`'s Box-allocated tree, which outlives
            // every queued item; short-lived read, no aliasing `&mut` is live here.
            if unsafe { first.active_scope.as_ref() }.failed {
                continue; // do not execute callbacks that came from a failed describe scope
            }

            let callback = &first.callback;
            let previous_scope = first.active_scope;
            let new_scope = first.new_scope;

            group::log(format_args!(
                "collection:runOne set scope from {}",
                bstr::BStr::new(this.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
            ));
            // `new_scope` was constructed from the `&mut DescribeScope` returned by
            // `append_describe`, so it carries write-capable provenance for `active_scope_mut()`.
            this.active_scope = new_scope;
            group::log(format_args!(
                "collection:runOne set scope to {}",
                bstr::BStr::new(this.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
            ));

            if let Some(cfg_data) = BunTest::run_test_callback(
                buntest_strong.clone(),
                global_this,
                callback.get(),
                false,
                RefDataValue::Collection { active_scope: previous_scope },
                &Timespec::EPOCH,
            ) {
                // the result is available immediately; queue
                // Re-derive after re-entrant call per BunTestCell::get aliasing contract.
                buntest_strong.get().add_result(cfg_data);
            }

            return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
        }
        Ok(StepResult::Complete)
    }

    pub fn handle_uncaught_exception(
        &mut self,
        _: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group::begin();

        self.active_scope_mut().failed = true;

        HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe // unhandled because it needs to exit with code 1
    }
}

// ported from: src/test_runner/Collection.zig
