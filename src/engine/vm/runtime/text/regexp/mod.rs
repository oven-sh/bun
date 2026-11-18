//! Regular expressions.

mod cache;
mod captures;
mod cell;
mod code;
mod exec;
mod global_search;
mod iterator;
mod machine_code;
mod match_all;
mod match_array;
mod object;
mod race;
mod receiver;
mod replace;
mod replace_function;
mod result_cache;
mod splice;
mod split;
mod statics;
mod subject;

pub use captures::{CaptureBuffer, Captures, Match};
pub use cell::RegExp;
pub use exec::{advance_string_index, regexp_exec};
pub(crate) use iterator::PlainMatchIterator;
pub use iterator::{RegExpStringIterator, advance_last_index};
pub use match_array::initialize_match_array_slot;
pub use object::RegExpObject;
pub use receiver::PlainRegExp;
pub use replace_function::MatchOnRecord;
pub use statics::RegExpGlobalState;
pub use subject::Subject;

use core::cell::RefCell;
use core::mem::offset_of;

use crate::heap::{Scope, Survivors};
use crate::services::Service;
use crate::{Visitor, Vm};

#[derive(Default)]
pub(super) struct State {
    matcher: code::Matcher,
    notes: race::KeptNotes,
    compiler: RefCell<bun_engine_regexp::Compiler>,
    machine_code_compiler: RefCell<bun_engine_regexp_jit::Compiler>,
    cache: cache::Cache,
    /// Lasts until the next full collection.
    replace_cache: result_cache::ResultCache<64>,
    recent_replacements: replace_function::RecentReplacements,
    /// Lasts until the next collection.
    split_cache: result_cache::ResultCache<256>,
}

impl State {
    pub(super) const OFFSET_OF_RUNNING: usize =
        offset_of!(State, matcher) + code::Matcher::OFFSET_OF_RUNNING;
    pub(super) const OFFSET_OF_CONTEXT: usize =
        offset_of!(State, matcher) + code::Matcher::OFFSET_OF_CONTEXT;
}

impl Service for State {
    fn initialize(&self, vm: &Vm) {
        self.matcher.initialize(vm);
    }

    fn visit(&self, visitor: &mut Visitor) {
        self.cache.visit(visitor);
        if visitor.scope() == Scope::Eden {
            self.replace_cache.visit(visitor);
        }
    }

    fn reconcile_weak_references(&self, _: &Vm, survivors: &Survivors) {
        self.cache.prune(survivors);
        self.split_cache.clear();
        self.recent_replacements.clear();
        if survivors.scope() == Scope::Full {
            self.replace_cache.clear();
        }
        self.notes.prune(survivors);
        self.trim();
    }
}

impl State {
    fn trim(&self) {
        self.matcher.trim();
        self.compiler.borrow_mut().trim();
        self.machine_code_compiler.borrow_mut().trim();
    }
}

impl Vm {
    #[inline(always)]
    fn regexps(&self) -> &State {
        &self.services.text.regexps
    }

    /// What is used again is compiled again.
    pub fn delete_regexp_code(&self) {
        self.regexps().cache.delete_code(self);
        self.regexps().notes.clear();
        self.regexps().trim();
    }

    /// The address of the `RegExp` that is searching, or zero. For a thread that has suspended this one.
    pub fn running_regexp(&self) -> usize {
        self.regexps().matcher.running()
    }
}
