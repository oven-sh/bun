//! Code that takes over from baseline code at the start of a loop.

use bun_engine_codegen::ir::{Block, Boundary, Type};
use bun_engine_wasm_format::BlockType;

use super::control::Kind;
use super::locals::Typed;
use super::translator::{Operand, Translator, ir_type};
use crate::baseline::Frame;

impl Translator<'_> {
    /// For each loop until the one at which the code is entered.
    pub(super) fn seek_loop(&mut self, ty: BlockType, index: u32) {
        if self.open_loops == 0 {
            self.sites_before_loops = self.sites_seen;
        }
        if self.loop_entry == Some(index) {
            self.take_over_frame(ty);
        } else {
            self.open_loops += 1;
        }
    }

    fn take_over_frame(&mut self, ty: BlockType) {
        let declared = self.types.block_type(&ty).params;
        let first = self.stack.len() - declared.len();
        for (operand, &ty) in self.stack[first..].iter_mut().zip(declared) {
            operand.ty = ty;
        }

        let (mut params, mut local_types) = (Vec::new(), Vec::new());
        let frame = Frame::new(&self.root, &self.signature, |ty, offset| {
            params.push((ir_type(ty), Boundary::Frame(offset)));
            local_types.push(ty);
        });
        for (position, operand) in (0..).zip(&self.stack) {
            let place = Boundary::Frame(frame.operand(position));
            params.push((ir_type(operand.ty), place));
        }
        let is_catch = |kind: &Kind| matches!(kind, Kind::Catch { .. });
        let catches = (self.controls.iter()).filter(|control| is_catch(&control.kind));
        for depth in 0..catches.count() as u32 {
            params.push((Type::I64, Boundary::Frame(frame.exception(depth))));
        }

        let entry = self.start_function(&params);
        self.b.reserved_frame_bytes = frame.size();
        let mut values = self.b.params(entry).iter().copied();
        let caller = self.locals.snapshot();
        for (ty, value) in local_types.into_iter().zip(&mut values) {
            self.locals.declare(1, ty, Typed { value, ty });
        }
        for (operand, value) in self.stack.iter_mut().zip(&mut values) {
            *operand = Operand::new(value, operand.ty);
        }
        let mut depth = 0;
        for control in &mut self.controls {
            control.forget_arrivals();
            match control.kind {
                Kind::Loop { index, .. } => {
                    control.kind = Kind::FirstTurn { index, depth };
                    depth += 1;
                }
                Kind::Catch { .. } => {
                    let exception = values.next().expect("one for each");
                    control.kind = Kind::Catch { exception };
                }
                Kind::Body { .. } => {
                    let header = None;
                    control.kind = Kind::Body { header, caller };
                }
                _ => {}
            }
        }

        self.is_seeking = false;
        self.activation.innermost_loop = (Block::NONE, 0);
        let first_site = Some(self.sites_before_loops);
        self.inlining.decide(self.module, self.feedback, first_site);
    }
}
