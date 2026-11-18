//! Calls whose arguments come from lists.

use bun_engine_bytecode::{MetadataKind, Register, SpreadMaskIndex, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::{CallFrame, SpeculatedType as T};
use smallvec::SmallVec;

use super::arrays::Values;
use super::calls::CallSite;
use super::fork::Odds;
use super::frame::ArgumentCount;
use super::{Builder, Built};
use crate::graph::{ExitKind, Kind, Lists, heaps};

const MOST_FORWARDED: u32 = 12;

impl Builder<'_> {
    pub(super) fn to_argument_list(&mut self, op: op::ToArgumentList) {
        let value = self.get(op.value);
        let list = if self.is(value, T::EMPTY | T::NULLISH) {
            value
        } else if self.try_without_object(value) {
            self.empty()
        } else if let Some(values) = self.elements_as_list(value) {
            self.list_of(&values)
        } else if let Some(array) = self.array_as_list(value) {
            array
        } else if self.is(value, T::HEAP_TOP) {
            self.node(Kind::ToArgumentList, &[self.graph.root(value)], 0)
        } else {
            return self.interpret();
        };
        self.set(op.dst, list);
    }

    /// Those of the current function from `skip` on, if their number is known or can be guessed.
    pub(super) fn own_arguments(&mut self, skip: u32) -> Option<SmallVec<[Ssa; 8]>> {
        let count = match self.frame().argument_count {
            ArgumentCount::Known(count) => count,
            ArgumentCount::InFrame => {
                let seen = self.argument_count_seen;
                if !(1..=MOST_FORWARDED).contains(&seen)
                    || self.frame().code_block.has_had_several_argument_counts()
                    || self.has_exited(ExitKind::TooManyArguments)
                {
                    return None;
                }
                let count = self.argument_count();
                let differs = self.ir().not_equal(count, seen as i32 - 1);
                self.exit_if(differs, ExitKind::TooManyArguments);
                seen
            }
        };
        let with_register = self.frame().argument_registers().count() as u32;
        let argument = |index| {
            if index + 1 < with_register {
                return self.frame().get(Register::argument(index));
            }
            let (frame, offset) = (self.frame_pointer(), CallFrame::OFFSET_OF_ARGUMENTS as i32);
            let value = (self.ir()).load(Type::I64, frame, offset + index as i32 * 8, heaps::FRAME);
            self.graph.declare(value, T::HEAP_TOP);
            self.graph.predict(value, T::HEAP_TOP);
            value
        };
        Some((skip..count - 1).map(argument).collect())
    }

    /// For a list that may be empty, where the call is left to find out what is in it.
    fn list_for_call(&mut self, list: Ssa, skip_in_frame: u32) -> Ssa {
        if self.is(list, T::HEAP_TOP) {
            return list;
        }
        if self.frame().is_root() {
            self.flush_arguments();
            return list;
        }
        let Some(own) = self.few_arguments(skip_in_frame) else {
            // The next time, the function is not inlined.
            return self.check_type_or(list, T::HEAP_TOP, ExitKind::ArgumentsEscaped);
        };
        let is_empty = self.is_type(list, T::EMPTY);
        let list = self.choose(is_empty, Odds::Even, |this, is_empty| {
            Some(if is_empty { this.list_of(&own) } else { list })
        });
        list.expect("a list")
    }

    /// The only argument of the site is `this` or `new.target`. An empty list stands for the own arguments.
    pub(super) fn call_varargs(
        &mut self,
        site: CallSite<'_>,
        kind: MetadataKind,
        list: Ssa,
        [skip_in_list, skip_in_frame]: [u32; 2],
    ) -> Built {
        let known = if self.is(list, T::NULLISH) {
            Some(SmallVec::new())
        } else if self.is(list, T::EMPTY) {
            self.own_arguments(skip_in_frame)
        } else {
            let all = self.flatten(&[list], |_| true);
            all.map(|all| all.into_iter().skip(skip_in_list as usize).collect())
        };
        if let Some(mut arguments) = known {
            arguments.insert(0, site.arguments[0]);
            let arguments = &arguments;
            return self.call(CallSite { arguments, ..site }, kind);
        }
        let list = self.list_for_call(list, skip_in_frame);
        let list = self.without_copy(list);
        let lists = Lists {
            skip_in_list: Some(skip_in_list),
            skip_in_frame,
        };
        self.call_with_lists(site, &[list], lists);
        Ok(())
    }

    /// The arguments of the site are `this` and the parts.
    pub(super) fn call_with_spread(
        &mut self,
        site: CallSite<'_>,
        mask: SpreadMaskIndex,
        skip_in_frame: u32,
    ) -> Built {
        let code_block = self.frame().code_block;
        let is_list = |position| code_block.body().is_spread(mask, position);
        let mut parts = Values::from(&site.arguments[1..]);
        if parts.iter().any(|&it| self.is(it, T::EMPTY))
            && let Some(own) = self.few_arguments(skip_in_frame)
        {
            let own = self.list_of(&own);
            (parts.iter_mut().filter(|it| self.is(**it, T::EMPTY))).for_each(|it| *it = own);
        }
        if let Some(mut arguments) = self.flatten(&parts, is_list) {
            arguments.insert(0, site.arguments[0]);
            let arguments = &arguments;
            return self.call(CallSite { arguments, ..site }, MetadataKind::Call);
        }
        for (part, position) in parts.iter_mut().zip(0..) {
            if is_list(position) {
                *part = self.list_for_call(*part, skip_in_frame);
            }
        }
        let last = parts.len() as u32 - 1;
        let is_only_last = is_list(last) && !(0..last).any(is_list);
        if is_only_last {
            parts[last as usize] = self.without_copy(parts[last as usize]);
        }
        let lists = Lists {
            skip_in_list: is_only_last.then_some(0),
            skip_in_frame,
        };
        self.call_with_lists(site, &parts, lists);
        Ok(())
    }

    fn call_with_lists(&mut self, site: CallSite<'_>, parts: &[Ssa], lists: Lists) {
        let all = [site.callee, site.arguments[0]].into_iter();
        let operands: SmallVec<[Ssa; 8]> = (all.chain(parts.iter().copied()))
            .map(|operand| self.graph.root(operand))
            .collect();
        let kinds = [
            Kind::CallVarargs,
            Kind::ConstructVarargs,
            Kind::TailCallVarargs,
        ];
        let result = self.make_call(&site, false, kinds, &operands, lists.to_data());
        if let Some((dst, result)) = site.dst.zip(result) {
            self.set(dst, result);
        }
    }
}
