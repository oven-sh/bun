//! Strings, regular expressions, dates and JSON.

mod date;
pub mod json;
mod regexp;
mod string;

pub use date::DateInstance;
pub use regexp::*;
pub use string::*;

use crate::heap::Survivors;
use crate::{Visitor, Vm};

#[derive(Default)]
pub(crate) struct State {
    dates: bun_engine_date::DateCache,
    json: json::State,
    regexps: regexp::State,
    strings: string::State,
}

impl State {
    pub(crate) const OFFSET_OF_RUNNING_REGEXP: usize =
        core::mem::offset_of!(State, regexps) + regexp::State::OFFSET_OF_RUNNING;
    pub(crate) const OFFSET_OF_REGEXP_CONTEXT: usize =
        core::mem::offset_of!(State, regexps) + regexp::State::OFFSET_OF_CONTEXT;
}

impl crate::services::Service for State {
    fn initialize(&self, vm: &Vm) {
        self.regexps.initialize(vm);
    }

    #[inline]
    fn will_enter(&self, vm: &Vm) {
        vm.follow_time_zone();
    }

    fn visit(&self, visitor: &mut Visitor) {
        self.json.visit(visitor);
        self.regexps.visit(visitor);
    }

    fn reconcile_weak_references(&self, vm: &Vm, survivors: &Survivors) {
        self.json.reconcile_weak_references(vm, survivors);
        self.regexps.reconcile_weak_references(vm, survivors);
        self.strings.clear_caches();
    }
}
