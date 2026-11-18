//! Forms of built-ins: their calls, and the ways around those.

mod dates;
mod searches;
mod text;
mod views;

use bun_engine_asm::Target;
use bun_engine_codegen::ir::{Action, EffectFlags, Heap, Type, Value as Ssa};
use bun_engine_vm::JsSymbol;
use bun_engine_vm::direct::{Context, Form, Gives, Kind as Wanted, Reach, State, Throws};
use smallvec::SmallVec;

use super::emit::{Site, Threw};
use super::operations::while_collecting;
use super::ways::{Detour, Meeting};
use super::{Lowering, Odds};
use crate::graph::{ExitKind, FormCall, heaps};

/// How the code that stands in for a call ends.
struct Ways {
    done: Meeting,
    /// To the call.
    slow: Detour,
}

impl Lowering<'_> {
    pub(super) fn do_as_form(&mut self, call: FormCall) -> Ssa {
        use Form::*;
        let operands = self.operands();
        let passed = &operands[usize::from(call.form.context == Context::Realm)..];
        let shortcut: fn(&mut Self, &mut Ways, FormCall, &[Ssa]) -> Ssa = match call.form {
            slice | substring | substr => Self::part_of_string,
            trim | trim_start | trim_end => Self::trim,
            starts_with_in_characters | starts_with | ends_with_in_characters | ends_with
                if self.short_text(passed[1]).is_some() =>
            {
                Self::has_at_end
            }
            symbol_to_string => Self::string_of_symbol,
            test_pattern | test_plain | search | symbol_search => Self::find_match,
            exec_pattern | exec_plain | match_once | symbol_match_once if call.groups.is_some() => {
                Self::find_match
            }
            form => return self.call_form(form),
        };
        let mut ways = Ways {
            done: self.part(self.graph.function.type_of(self.at)),
            slow: Detour::default(),
        };
        let result = shortcut(self, &mut ways, call, passed);
        self.give(ways.done, result);
        self.meet_after(ways.done, ways.slow, |this| this.call_form(call.form))
    }

    fn string_of_symbol(&mut self, ways: &mut Ways, _: FormCall, passed: &[Ssa]) -> Ssa {
        let offset = JsSymbol::OFFSET_OF_STRING;
        let kept = self.load(Type::I64, passed[0], offset, heaps::STRING_FIBER);
        let is_missing = self.ir().is_zero(kept);
        self.detour_if(is_missing, Odds::Low, &mut ways.slow);
        kept
    }

    fn call_form(&mut self, form: Form) -> Ssa {
        let (operands, mut args) = (self.operands(), SmallVec::<[Ssa; 8]>::new());
        let mut operands = operands.into_iter();
        match form.context {
            Context::None => {}
            Context::Vm => args.push(self.vm()),
            Context::Realm => args.extend(operands.next()),
        }
        let (passed, mut reads_text) = (form.operands.iter().filter(|it| it.is_passed), false);
        for (operand, value) in passed.zip(operands) {
            let is_text = operand.kind == Wanted::Characters;
            args.push(if is_text {
                self.characters(value)
            } else {
                value
            });
            reads_text |= is_text;
        }
        let mut effects = self.graph.function.effects(self.at);
        let site = if form.reach == Reach::Leaf {
            effects.flags = EffectFlags::CONTROL_DEPENDENT;
            if form.reads.is_empty() && !reads_text {
                effects.reads = Heap::NOTHING;
            }
            if form.reads.contains(State::DATE) {
                effects.writes = heaps::WORLD;
            }
            Site::Nothing
        } else {
            effects = while_collecting(effects.writes);
            if form.writes.contains(State::LAST_INDEX) {
                effects.writes = heaps::BACKING_AND_LAST_INDEX;
            }
            match form.throws {
                Throws::Never => Site::Operation(self.origin, Threw::Never),
                _ => Site::Operation(self.origin, Threw::Unnoticed),
            }
        };
        let data = self.patchpoint(Action::Call(Target::Address(form.entry())), site, effects);
        let result = self.call_native(data, &args, &[self.graph.function.type_of(self.at)]);
        if form.throws != Throws::Never {
            let has_thrown = match form.gives {
                Gives::Int32 { .. } => self.ir().equal(result, Gives::THREW_INT32),
                Gives::Boolean => self.ir().equal(result, Gives::THREW_BOOLEAN),
                _ => self.ir().is_zero(result),
            };
            self.exit_if(has_thrown, ExitKind::Threw);
        }
        result
    }
}
