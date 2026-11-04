use bun_sema::atom::known;
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, Flags, FnKind, ParamId, PropKey, PropKind};
use smallvec::SmallVec;

use super::intrinsic::has_spread;
use super::written_operands::find_locked_builtin;
use super::{call_site, emit_call};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, MemberLookup};
use crate::ir::{Edge, TypeTable, ValueId};
use crate::lower::expression::{Tail, TailCast};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone)]
struct FilledArray {
    array: ExprId,
    length: ExprId,
    value: ExprId,
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_written_length(&self, items: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[items].kind else {
            return None;
        };
        let mut properties = properties.iter();
        let property = &hir[properties.next()?];
        let is_value = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
        let is_length = matches!(property.key, PropKey::Name(name) if name == known::length);
        (properties.next().is_none() && is_value && is_length).then_some(property.value)
    }

    fn find_array_of_length(&self, expression: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[expression].kind else {
            return None;
        };
        let site = hir[site];
        if !matches!(site.chain, Chain::No)
            || find_locked_builtin(self, site.callee) != Some(BuiltinId::Array)
        {
            return None;
        }
        self.find_only_argument(site)
    }

    fn position_of_array_call(&self, expression: ExprId) -> u32 {
        match self.hir[expression].kind {
            ExprKind::Call(site) => self.call_position(self.hir[site]),
            _ => self.construct_position(expression),
        }
    }

    // `receiver.name(..)`. Where the receiver is a list that the expression itself makes, the name finds what Array.prototype holds under it.
    fn find_method_of_fresh_array(&self, site: Call) -> Option<(ExprId, BuiltinId)> {
        let ExprKind::Dot {
            obj: receiver,
            name,
            chain: Chain::No,
            ..
        } = self.hir[site.callee].kind
        else {
            return None;
        };
        let is_made_here = matches!(
            self.hir[receiver].kind,
            ExprKind::Call(_) | ExprKind::New(_)
        );
        if !is_made_here || !matches!(site.chain, Chain::No) {
            return None;
        }
        let name = self.inputs.builtin_names.get(name)?;
        let MemberLookup::Found(method) = table::member(BuiltinId::ArrayPrototype, name) else {
            return None;
        };
        self.is_fixed_method(method)
            .then_some((receiver, table::canonical_id(method)))
    }

    fn find_filled_array(&self, site: Call) -> Option<FilledArray> {
        let (array, method) = self.find_method_of_fresh_array(site)?;
        if method != BuiltinId::ArrayPrototypeFill {
            return None;
        }
        Some(FilledArray {
            array,
            length: self.find_array_of_length(array)?,
            value: self.find_only_argument(site)?,
        })
    }

    // An arrow function has no `arguments`: it sees what its parameters name.
    fn takes_at_most_two_parameters(&self, mapper: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Fn(function) = hir[mapper].kind else {
            return false;
        };
        let function = &hir[function];
        let is_rest = |parameter: ParamId| hir[parameter].flags.contains(Flags::REST);
        function.kind == FnKind::Arrow
            && function.params.len() <= 2
            && !function.params.iter().any(is_rest)
    }

    fn is_evaluated_without_effect(&self, expression: ExprId) -> bool {
        matches!(
            self.hir[expression].kind,
            ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Fn(_)
        )
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // A maker that stands for one call of the program is in tail position where that call is.
    fn emit_maker_at(
        &mut self,
        call: ExprId,
        maker: BuiltinId,
        this: Option<ValueId>,
        operands: &[ValueId],
        tail: Tail<'_>,
    ) -> ValueId {
        let site = call_site(self.file, call);
        self.set_position(self.file.call_position(site));
        let callee = self.emit_builtin_itself(maker);
        let made = emit_call(self, callee, this, operands);
        let Tail::Yes { casts } = tail else {
            self.set_position(self.file.hir[call].pos);
            return self.claim_call_result(call, made);
        };
        let position = self.file.find_position_of_returned_call(call);
        let cast = TailCast {
            positions: std::slice::from_ref(&position),
            outer: casts,
            breaks_no_int32_promise: false,
        };
        self.return_call_in_tail_position(made, Tail::Yes { casts: Some(&cast) })
    }

    fn lower_only_argument(&mut self, call: ExprId, argument: ExprId) -> ValueId {
        let mut arguments = [self.lower_expression(argument)];
        self.convert_arguments(call, &mut arguments);
        arguments[0]
    }

    // `Array(-1)` throws where it is written, before what stands behind it is evaluated.
    fn lower_checked_length(&mut self, array: ExprId, length: ExprId) -> ValueId {
        let length = self.lower_only_argument(array, length);
        self.set_position(self.file.position_of_array_call(array));
        self.emit_builtin_call(BuiltinId::CompilerHelpersCheckedArrayLength, &[length])
    }

    pub(super) fn lower_array_from(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
        if has_spread(hir, &arguments) {
            return None;
        }
        let (&items, mapper) = match arguments.as_slice() {
            [items] => (items, None),
            [items, mapper] => (items, Some(*mapper)),
            _ => return None,
        };
        let Some(length) = self.file.find_written_length(items) else {
            return match mapper {
                None => Some(self.lower_copy_by_array_from(call, items, tail)),
                Some(mapper) => self.lower_mapped_copy_by_array_from(call, items, mapper, tail),
            };
        };
        self.emit_locked_builtin(BuiltinId::ArrayFrom);
        let length = self.lower_expression(length);
        let Some(mapper) = mapper else {
            let maker = BuiltinId::CompilerHelpersArrayOfUndefined;
            return Some(self.emit_maker_at(call, maker, None, &[length], tail));
        };
        let is_written_as_function = matches!(hir[mapper].kind, ExprKind::Fn(_));
        let mut written = [self.builder.undefined(), self.lower_expression(mapper)];
        self.convert_arguments(call, &mut written);
        if is_written_as_function {
            let operands = [length, written[1]];
            let maker = BuiltinId::CompilerHelpersArrayFromLength;
            return Some(self.emit_maker_at(call, maker, None, &operands, tail));
        }

        // Array.from takes undefined for no mapper at all, and the list then holds undefined: not what a mapper returns.
        let split = self.split_on_type(written[1], TypeTable::UNDEFINED);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        self.builder.switch_to(split.taken);
        let maker = BuiltinId::CompilerHelpersArrayOfUndefined;
        let made = self.emit_maker_at(call, maker, None, &[length], tail);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        let operands = [length, split.not_taken_value];
        let maker = BuiltinId::CompilerHelpersArrayFromLength;
        let made = self.emit_maker_at(call, maker, None, &operands, tail);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.continue_in(join);
        Some(self.builder.read_variable(result))
    }

    fn emit_copy_by_spread(&mut self, call: ExprId, items: ExprId, value: ValueId) -> ValueId {
        self.set_position(self.file.hir[items].pos);
        let copy = self.builder.new_array(TypeTable::ANYTHING, &[], &[]);
        self.builder.append_spread(copy, value);
        self.set_position(self.file.hir[call].pos);
        self.claim_call_result(call, copy)
    }

    // `Array.from(list)` of a list with its own names is `[...list]`: a hole reads as undefined in both. One that has lost or replaced its iterator is not.
    // `Array.from(text)` is `[...text]` too: a string has the iterator of its class.
    fn lower_copy_by_array_from(&mut self, call: ExprId, items: ExprId, tail: Tail<'_>) -> ValueId {
        self.emit_locked_builtin(BuiltinId::ArrayFrom);
        // `Array.from(new Set(list))`: what was made just here has the iterator of its class.
        let made = self.file.skip_type_syntax(items);
        let constructed = match self.file.hir[made].kind {
            ExprKind::New(site) => find_locked_builtin(self.file, self.file.hir[site].callee),
            _ => None,
        };
        let iterator = match constructed {
            Some(BuiltinId::Set) => Some(BuiltinId::SetPrototypeSymbolIterator),
            Some(BuiltinId::Map) => Some(BuiltinId::MapPrototypeSymbolIterator),
            _ => None,
        };
        // Without an iterator `Array.from` reads a length, where a spread throws.
        let is_new_collection =
            iterator.is_some_and(|iterator| self.file.is_fixed_method(iterator));
        let value = self.lower_expression(items);
        if is_new_collection {
            return self.emit_copy_by_spread(call, items, value);
        }
        self.set_position(self.file.hir[items].pos);
        let is_pristine = self.builder.is_pristine_array(value);
        let (taken, not_taken) = (self.create_block(), self.create_block());
        self.builder
            .branch(is_pristine, Edge::to(taken), Edge::to(not_taken));
        self.builder.seal(taken);
        self.builder.seal(not_taken);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        self.builder.switch_to(taken);
        let copy = self.emit_copy_by_spread(call, items, value);
        self.builder.write_variable(result, copy);
        self.jump(join);
        self.builder.switch_to(not_taken);
        let mut value = value;
        if self
            .file
            .is_fixed_method(BuiltinId::StringPrototypeSymbolIterator)
        {
            let split = self.split_on_type(value, TypeTable::STRING);
            self.builder.switch_to(split.taken);
            let copy = self.emit_copy_by_spread(call, items, split.taken_value);
            self.builder.write_variable(result, copy);
            self.jump(join);
            self.builder.switch_to(split.not_taken);
            value = split.not_taken_value;
        }
        let this = self.emit_builtin_itself(BuiltinId::Array);
        let made = self.emit_maker_at(call, BuiltinId::ArrayFrom, Some(this), &[value], tail);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    // `Array.from(list, value => ..)`: the iterator of a list with its own names hands out what lies at each index, which the maker reads by itself. Evaluating a function that is written there does nothing.
    fn lower_mapped_copy_by_array_from(
        &mut self,
        call: ExprId,
        items: ExprId,
        mapper: ExprId,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        if !matches!(self.file.hir[mapper].kind, ExprKind::Fn(_)) {
            return None;
        }
        self.emit_locked_builtin(BuiltinId::ArrayFrom);
        let mut written = [self.lower_expression(items), self.lower_expression(mapper)];
        self.convert_arguments(call, &mut written);
        self.set_position(self.file.hir[items].pos);
        let is_pristine = self.builder.is_pristine_array(written[0]);
        let (taken, not_taken) = (self.create_block(), self.create_block());
        self.builder
            .branch(is_pristine, Edge::to(taken), Edge::to(not_taken));
        self.builder.seal(taken);
        self.builder.seal(not_taken);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        self.builder.switch_to(taken);
        let maker = BuiltinId::CompilerHelpersArrayFromList;
        let made = self.emit_maker_at(call, maker, None, &written, tail);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.builder.switch_to(not_taken);
        let this = self.emit_builtin_itself(BuiltinId::Array);
        let made = self.emit_maker_at(call, BuiltinId::ArrayFrom, Some(this), &written, tail);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.continue_in(join);
        Some(self.builder.read_variable(result))
    }

    fn lower_filled_array(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let filled = self.file.find_filled_array(site)?;
        // The maker throws what `Array(n)` throws. Nothing else in it can be seen.
        let length = match self.file.is_evaluated_without_effect(filled.value) {
            true => self.lower_only_argument(filled.array, filled.length),
            false => self.lower_checked_length(filled.array, filled.length),
        };
        let value = self.lower_only_argument(call, filled.value);
        self.set_position(self.file.position_of_array_call(filled.array));
        let made = self.emit_builtin_call(BuiltinId::CompilerHelpersFilledArray, &[length, value]);
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    fn lower_mapped_filled_array(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        let file = &*self.file;
        let (receiver, method) = file.find_method_of_fresh_array(site)?;
        let ExprKind::Call(fill) = file.hir[receiver].kind else {
            return None;
        };
        if method != BuiltinId::ArrayPrototypeMap {
            return None;
        }
        let filled = file.find_filled_array(file.hir[fill])?;
        let mapper = file.find_only_argument(site)?;
        if !file.takes_at_most_two_parameters(mapper) {
            return None;
        }

        let length = self.lower_checked_length(filled.array, filled.length);
        let value = self.lower_only_argument(receiver, filled.value);
        let mapper = self.lower_only_argument(call, mapper);
        let operands = [length, value, mapper];
        let maker = BuiltinId::CompilerHelpersMappedFilledArray;
        Some(self.emit_maker_at(call, maker, None, &operands, tail))
    }

    pub(super) fn try_lower_method_call(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        self.lower_filled_array(call, site)
            .or_else(|| self.lower_mapped_filled_array(call, site, tail))
    }
}
