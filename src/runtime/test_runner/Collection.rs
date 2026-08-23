//! for the collection phase of test execution where we discover all the test() calls

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::test_runner::expect::make_formatter;

use bun_core::Timespec;
use bun_jsc::{DeprecatedStrong, JSGlobalObject, JSValue, JsResult};

use crate::test_runner::bun_test::debug::group;
use crate::test_runner::bun_test::{
    self, BunTestPtr, DescribeScope, HandleUncaughtExceptionResult, RefDataValue, StepResult,
};
use crate::test_runner::jest::Jest;

pub struct Collection {
    /// set to true after collection phase ends
    pub(crate) locked: Cell<bool>,
    pub(crate) describe_callback_queue: RefCell<Vec<QueuedDescribe>>,
    pub(crate) current_scope_callback_queue: RefCell<Vec<QueuedDescribe>>,

    pub(crate) root_scope: Rc<DescribeScope>,
    active_scope: RefCell<Rc<DescribeScope>>,

    pub(crate) filter_buffer: RefCell<Vec<u8>>,
}

pub struct QueuedDescribe {
    callback: DeprecatedStrong, // jsc.Strong.Deprecated
    active_scope: Rc<DescribeScope>,
    new_scope: Rc<DescribeScope>,
}

impl Collection {
    pub(crate) fn init(hook_scope: &Rc<DescribeScope>) -> Collection {
        let _g = group::begin();

        let only = if let Some(runner) = Jest::runner() {
            if runner.only.get() {
                bun_test::Only::Contains
            } else {
                bun_test::Only::No
            }
        } else {
            bun_test::Only::No
        };

        let root_scope = DescribeScope::create(bun_test::BaseScope {
            parent: Some(Rc::downgrade(hook_scope)),
            name: None,
            concurrent: false,
            mode: bun_test::ScopeMode::Normal,
            only: Cell::new(only),
            has_callback: Cell::new(false),
            test_id_for_debugger: Cell::new(0),
            line_no: 0,
        });

        Collection {
            locked: Cell::new(false),
            describe_callback_queue: RefCell::new(Vec::new()),
            current_scope_callback_queue: RefCell::new(Vec::new()),
            active_scope: RefCell::new(Rc::clone(&root_scope)),
            root_scope,
            filter_buffer: RefCell::new(Vec::new()),
        }
    }

    /// The currently-active describe scope.
    #[inline]
    pub(crate) fn active_scope(&self) -> Rc<DescribeScope> {
        Rc::clone(&self.active_scope.borrow())
    }

    fn set_active_scope(&self, scope: Rc<DescribeScope>) {
        *self.active_scope.borrow_mut() = scope;
    }

    pub(crate) fn enqueue_describe_callback(
        &self,
        new_scope: Rc<DescribeScope>,
        callback: Option<JSValue>,
    ) -> JsResult<()> {
        let _g = group::begin();

        debug_assert!(!self.locked.get());

        if let Some(cb) = callback {
            let active_scope = self.active_scope();
            group::log(format_args!(
                "enqueueDescribeCallback / {} / in scope: {}",
                bstr::BStr::new(new_scope.base.name.as_deref().unwrap_or(b"(unnamed)")),
                bstr::BStr::new(active_scope.base.name.as_deref().unwrap_or(b"(unnamed)")),
            ));

            self.current_scope_callback_queue
                .borrow_mut()
                .push(QueuedDescribe {
                    active_scope,
                    callback: DeprecatedStrong::init(cb),
                    new_scope,
                });
        }
        Ok(())
    }

    pub(crate) fn run_one_completed(
        &self,
        global_this: &JSGlobalObject,
        _: Option<JSValue>,
        data: &RefDataValue,
    ) -> JsResult<()> {
        let _g = group::begin();

        let _formatter = make_formatter(global_this);

        // The named scope is part of `self.root_scope`'s tree, which lives as
        // long as `self`.
        let prev_scope: Rc<DescribeScope> = match data {
            RefDataValue::Collection { active_scope } => active_scope.upgrade(),
            _ => None,
        }
        .unwrap_or_else(|| {
            debug_assert!(false); // this probably can't happen
            self.active_scope()
        });

        group::log(format_args!(
            "collection:runOneCompleted reset scope back from {}",
            bstr::BStr::new(
                self.active_scope()
                    .base
                    .name
                    .as_deref()
                    .unwrap_or(b"undefined")
            ),
        ));
        self.set_active_scope(prev_scope);
        group::log(format_args!(
            "collection:runOneCompleted reset scope back to {}",
            bstr::BStr::new(
                self.active_scope()
                    .base
                    .name
                    .as_deref()
                    .unwrap_or(b"undefined")
            ),
        ));
        Ok(())
    }

    pub(crate) fn step(
        buntest_strong: &BunTestPtr,
        global_this: &JSGlobalObject,
        data: &RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group::begin();
        let buntest = &**buntest_strong;
        let this = &buntest.collection;

        if !matches!(data, RefDataValue::Start) {
            this.run_one_completed(global_this, None, data)?;
        }

        let _formatter = make_formatter(global_this);

        // append queued callbacks, in reverse order because items will be pop()ed from the end
        let queued: Vec<QueuedDescribe> = this
            .current_scope_callback_queue
            .borrow_mut()
            .drain(..)
            .collect();
        for item in queued.into_iter().rev() {
            if item.new_scope.failed.get() {
                // if there was an error in the describe callback, don't run any describe callbacks in this scope
                drop(item); // Strong released here
            } else {
                this.describe_callback_queue.borrow_mut().push(item);
            }
        }

        loop {
            let Some(first) = this.describe_callback_queue.borrow_mut().pop() else {
                break;
            };
            group::log(format_args!("runOne -> call next"));
            // `first` cleanup handled by Drop at end of loop body / continue.

            if first.active_scope.failed.get() {
                continue; // do not execute callbacks that came from a failed describe scope
            }

            let callback = &first.callback;
            let previous_scope = Rc::clone(&first.active_scope);
            let new_scope = Rc::clone(&first.new_scope);

            group::log(format_args!(
                "collection:runOne set scope from {}",
                bstr::BStr::new(
                    this.active_scope()
                        .base
                        .name
                        .as_deref()
                        .unwrap_or(b"undefined")
                ),
            ));
            this.set_active_scope(new_scope);
            group::log(format_args!(
                "collection:runOne set scope to {}",
                bstr::BStr::new(
                    this.active_scope()
                        .base
                        .name
                        .as_deref()
                        .unwrap_or(b"undefined")
                ),
            ));

            if let Some(cfg_data) = buntest.run_test_callback(
                global_this,
                callback.get(),
                false,
                RefDataValue::Collection {
                    active_scope: Rc::downgrade(&previous_scope),
                },
                &Timespec::EPOCH,
            ) {
                // the result is available immediately; queue
                buntest.add_result(cfg_data);
            }

            return Ok(StepResult::Waiting {
                timeout: Timespec::EPOCH,
            });
        }
        Ok(StepResult::Complete)
    }

    pub(crate) fn handle_uncaught_exception(
        &self,
        _: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group::begin();

        self.active_scope().failed.set(true);

        HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe // unhandled because it needs to exit with code 1
    }
}
