//! Throwing and catching.

use bun_engine_wasm_format::{BlockType, Flow, TagIndex};
use bun_engine_wasm_runtime::interpreted::slot_count;

use super::control::Kind;
use super::emit::{Label, Revisable};
use super::operands::Operand;
use super::{Done, Translator};
use crate::handlers::Scope;
use crate::run::exceptions;

impl Translator<'_> {
    pub(super) fn open_try(&mut self, kind: Kind, ty: BlockType) -> Done {
        let outer = self.innermost().scope;
        let scope = self.handlers.open(outer)?;
        self.open(kind, ty, scope)?;
        self.change_scope(scope)
    }

    fn change_scope(&mut self, scope: Scope) -> Done {
        self.revisable = Revisable::Nothing;
        self.handlers.change(self.position(), scope)
    }

    /// Returns the scope that ends.
    fn stop_catching(&mut self) -> Done<Scope> {
        let outer = self.blocks[self.blocks.len() - 2].scope;
        self.change_scope(outer)?;
        Ok(core::mem::replace(&mut self.innermost().scope, outer))
    }

    /// For one without `catch`.
    pub(super) fn end_try(&mut self, delegate: Option<Scope>, flow: Flow) -> Done {
        let scope = self.stop_catching()?;
        if let Some(to) = delegate {
            self.handlers.delegate(scope, to);
        }
        self.close(flow)
    }

    fn land(&mut self, scope: Scope, tag: Option<TagIndex>, first_slot: u32) -> Done {
        let target = self.bind(Label::UNUSED);
        self.handlers.add(scope, tag, target)?;
        match tag.is_some_and(|tag| !self.module.tag_params(tag).is_empty()) {
            true => self.emit(exceptions::unpack, 0, 0, first_slot),
            false => Ok(()),
        }
    }

    pub(super) fn start_catch(&mut self, tag: Option<TagIndex>, flow: Flow) -> Done {
        self.leave_part(flow)?;
        let (exception, of) = match self.innermost().kind {
            Kind::Catch { exception, of } => (exception, of),
            _ => {
                self.catch_depth += 1;
                let exception = self.first_exception_slot + self.catch_depth - 1;
                (exception, self.stop_catching()?)
            }
        };
        self.innermost().kind = Kind::Catch { exception, of };
        self.land(of, tag, self.free_slot())?;
        self.emit(exceptions::keep_exception, 0, 0, exception)?;
        self.push_all(tag.map_or(&[], |tag| self.module.tag_params(tag)));
        Ok(())
    }

    pub(super) fn end_try_table(&mut self, first_catch: usize, mut flow: Flow) -> Done {
        let scope = self.stop_catching()?;
        if first_catch != self.catches.len() {
            self.leave_part(flow)?;
            flow = Flow::Dead;
        }
        for index in first_catch..self.catches.len() {
            let catch = self.catches[index];
            let block = self.index_of_label(catch.label + 1);
            let first_slot = self.blocks[block].first_slot;
            self.land(scope, catch.tag, first_slot)?;
            if catch.passes_exnref {
                let payload = catch.tag.map_or(&[][..], |tag| self.module.tag_params(tag));
                let slot = first_slot + slot_count(payload) as u32;
                self.emit(exceptions::keep_exception, 0, 0, slot)?;
            }
            self.jump_to(block)?;
        }
        self.catches.truncate(first_catch);
        self.close(flow)
    }

    pub(super) fn throw_new(&mut self, tag: TagIndex) -> Done {
        let first = self.pop_settled(self.module.tag_params(tag).len())?;
        self.emit_low(exceptions::throw, first, tag.0)
    }

    pub(super) fn throw_again(&mut self, exception: Operand) -> Done {
        let slot = self.in_slot(exception, 0)?;
        self.emit(exceptions::throw_ref, slot, 0, 0)
    }
}
