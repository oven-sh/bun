//! What the shell keeps for each thread that runs scripts.

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_inspector::Controller;
use bun_engine_vm::{FastHashSet, JsPromise, Strong, TerminationDeadline, Vm};

use crate::command_line::CommandLine;
use crate::functions::Inbox;
use crate::prelude::*;

#[derive(Default)]
pub(crate) struct State {
    pub(crate) command_line: OnceCell<CommandLine>,
    pub(crate) has_failed: Cell<bool>,
    pub(crate) async_passes: Cell<u32>,
    pub(crate) expected_async_passes: Cell<u32>,
    /// What the shell adds to global objects, which does not show when their properties are listed.
    pub(crate) hidden_globals: RefCell<FastHashSet<Identifier>>,
    /// Those that had no handler at the time.
    pub(crate) rejected_promises: RefCell<Vec<Strong<Gc<JsPromise>>>>,
    pub(crate) inbox: Inbox,
    /// While a frontend is connected.
    pub(crate) inspector: RefCell<Option<Rc<Controller>>>,
    /// Of the calls with a time limit that are under way.
    pub(crate) deadlines: RefCell<Vec<Arc<TerminationDeadline>>>,
}

impl State {
    pub(crate) fn of(vm: &Vm) -> Rc<State> {
        vm.extension()
    }

    pub(crate) fn command_line(&self) -> &CommandLine {
        self.command_line.get().expect("set before a script runs")
    }
}
