//! Throwing and catching.

use core::ops::Range;

use bun_engine_codegen::ir::{Type, Value};
use bun_engine_wasm_format::{BlockType, HeapType, TagIndex, ValType};

use super::control::{Control, Kind, Target, Way};
use super::translator::{NONE, Translator, Visited, ir_type};
use crate::abi::{InstanceLayout, Operation, payload_offsets};
use crate::clauses::Scope;

const EXCEPTION: ValType = HeapType::EXN.non_null().value_type();

impl Translator<'_> {
    pub(super) fn scope_of(&self, handler: u32) -> Scope {
        (self.controls.get(handler as usize)).map_or(Scope::NONE, |control| control.scope)
    }

    pub(super) fn open_try(&mut self, kind: Kind, ty: BlockType) {
        let position = self.controls.len() as u32;
        let scope = self.sites.scopes.open(self.scope_of(self.handler()));
        let control = self.open(kind, ty);
        (control.handler, control.scope) = (position, scope);
    }

    fn note_clause(&mut self, tag: Option<TagIndex>) {
        let scope = self.innermost().scope;
        self.sites.scopes.add(scope, tag);
    }

    pub(super) fn throw_new(&mut self, tag: TagIndex) {
        let types = self.module.tag_params(tag);
        let values = self.pop_many(types.len());
        let size = payload_offsets(types).last().expect("it has a size");
        let address = if size == 0 {
            self.b.const64(0)
        } else {
            let slot = match self.payload {
                Some((slot, room)) if room >= size => slot,
                _ => self.payload.insert((self.b.add_slot(size, 8), size)).0,
            };
            self.b.slot_address(slot)
        };
        for (operand, offset) in values.iter().zip(payload_offsets(types)) {
            (self.b).store(operand.value, address, offset as i32, self.named.payload);
        }
        let tag = self.b.const32(tag.0 as i32);
        self.call_throwing(Operation::Throw, &[tag, address], self.handler());
    }

    /// `exception` is not null.
    pub(super) fn throw_to(&mut self, handler: u32, exception: Value) {
        if handler == NONE {
            return self.call_throwing(Operation::ThrowRef, &[exception], NONE);
        }
        self.push(exception, EXCEPTION);
        let thrown = self.controls[handler as usize].thrown;
        self.controls[handler as usize].thrown = self.arrive(thrown, self.here(), 1);
        self.pop();
        self.is_live = false;
    }

    /// Ends the part of the innermost block in which it catches, and goes on with what it has caught.
    fn take_exception(&mut self, outer: usize) -> Option<Value> {
        self.fall_to_end();
        let handler = self.controls[outer].handler;
        let control = self.innermost();
        control.handler = handler;
        let Control {
            landing,
            mut thrown,
            ..
        } = *control;
        self.meet(landing, &[]);
        if self.is_live {
            let (offset, heap) = (InstanceLayout::caught(self.env.host), self.named.payload);
            let taken = self.b.load(Type::I64, self.instance, offset, heap);
            self.push(taken, EXCEPTION);
            thrown = self.arrive(thrown, self.here(), 1);
            self.pop();
        }
        self.meet(thrown, &[EXCEPTION]);
        self.is_live.then(|| self.pop_value())
    }

    /// Goes on if the tag matches, with the payload on the stack. Returns the other way.
    fn match_tag(&mut self, exception: Value, tag: TagIndex) -> Target {
        let host = self.env.host;
        let actual = self.load_immutable(Type::I64, exception, host.exception_tag);
        let expected = self.load_fixed(Type::I64, self.instance, self.env.layout.tag(tag));
        let matches = self.b.equal(actual, expected);
        let edge = self.fork(matches, None);
        let other = self.arrive(Target::UNREACHED, Way::Edge(edge), 0);
        let types = self.module.tag_params(tag);
        for (&ty, offset) in types.iter().zip(payload_offsets(types)) {
            let offset = host.exception_payload + offset as i32;
            let value = self.load_immutable(ir_type(ty), exception, offset);
            self.push(value, ty);
        }
        other
    }

    /// What it catches is thrown again in the block at the position.
    pub(super) fn end_try(&mut self, position: usize) {
        let (from, to) = (
            self.innermost().scope,
            self.scope_of(self.controls[position].handler),
        );
        self.sites.scopes.delegate(from, to);
        if let Some(exception) = self.take_exception(position) {
            self.throw_to(self.handler(), exception);
        }
        self.close();
    }

    /// Goes on with the exception that the clauses so far have not matched.
    fn next_clause(&mut self) {
        self.fall_to_end();
        let other = core::mem::replace(&mut self.innermost().other, Target::UNREACHED);
        self.meet(other, &[]);
    }

    pub(super) fn start_catch(&mut self, tag: Option<TagIndex>) {
        let exception = if let Kind::Catch { exception } = self.innermost().kind {
            self.next_clause();
            exception
        } else {
            let caught = self.take_exception(self.controls.len() - 2);
            caught.unwrap_or(Value::NONE)
        };
        self.innermost().kind = Kind::Catch { exception };
        self.note_clause(tag);
        if let Some(tag) = tag.filter(|_| self.is_live) {
            self.innermost().other = self.match_tag(exception, tag);
        }
    }

    pub(super) fn end_catch(&mut self, exception: Value) {
        if self.innermost().other.is_reached() {
            self.next_clause();
            self.throw_to(self.handler(), exception);
        }
        self.close();
    }

    pub(super) fn end_try_table(&mut self, catches: Range<u32>) -> Visited {
        let height = self.innermost().height as usize;
        if let Some(exception) = self.take_exception(self.controls.len() - 2) {
            for index in catches.clone() {
                self.check_complexity()?;
                let catch = self.catches[index as usize];
                self.note_clause(catch.tag);
                let other = catch.tag.map(|tag| self.match_tag(exception, tag));
                if catch.passes_exnref {
                    self.push(exception, EXCEPTION);
                }
                self.jump_to(self.position_of(catch.label + 1));
                self.stack.truncate(height);
                let Some(other) = other else { break };
                self.meet(other, &[]);
            }
            if self.is_live {
                self.throw_to(self.handler(), exception);
            }
        }
        self.catches.truncate(catches.start as usize);
        self.close();
        Ok(())
    }
}
