use bun_sema::hir::{Call, Chain, ExprId, ExprKind, Flags, FnKind, ParamId, PropKey, PropKind};
use smallvec::SmallVec;

use super::call_site;
use super::intrinsic::has_spread;
use super::written_operands::find_locked_builtin;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Mutability};
use crate::ir::{TypeTable, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

// The ways in which programs write "a list of this length": `Array.from({ length }, mapper)`, `Array(length).fill(value)`.

fn is_named(file: &FileLowering<'_, '_, '_, '_>, key: PropKey, name: &[u8]) -> bool {
    matches!(key, PropKey::Name(atom) if file.queries.atom_bytes(atom) == name)
}

impl FileLowering<'_, '_, '_, '_> {
    // The `n` of `{ length: n }`.
    fn find_written_length(&self, items: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[items].kind else {
            return None;
        };
        let mut properties = properties.iter();
        let property = hir[properties.next()?];
        let is_value = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
        (properties.next().is_none() && is_value && is_named(self, property.key, b"length"))
            .then_some(property.value)
    }

    // `Array(n)`, `new Array(n)`
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

    // `receiver.name(..)`, where the receiver is a list that the expression itself makes: the method is the one of Array.prototype.
    fn find_receiver(&self, site: Call, name: &[u8], method: BuiltinId) -> Option<ExprId> {
        let ExprKind::Dot {
            obj: receiver,
            name: written,
            chain: Chain::No,
            ..
        } = self.hir[site.callee].kind
        else {
            return None;
        };
        let is_fixed = table::entry(method).mutability == Mutability::AlwaysLocked;
        let is_method = matches!(site.chain, Chain::No) && self.queries.atom_bytes(written) == name;
        (is_fixed && is_method).then_some(receiver)
    }

    // An arrow function has no `arguments`: it sees what its parameters name.
    fn takes_at_most_two_operands(&self, mapper: ExprId) -> bool {
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
    fn emit_maker(&mut self, call: ExprId, maker: BuiltinId, operands: &[ValueId]) -> ValueId {
        let callee = call_site(self.file, call).callee;
        self.set_position(self.file.last_mapped_position(callee));
        let made = self.emit_locked_call(maker, None, operands);
        self.set_position(self.file.hir[call].pos);
        self.claim_call_result(call, made)
    }

    // `Array(-1)` throws before what stands behind it is evaluated.
    fn lower_length(
        &mut self,
        construction: ExprId,
        length: ExprId,
        evaluated_behind: &[ExprId],
    ) -> ValueId {
        let length = self.lower_operand_of_question(construction, length);
        if evaluated_behind
            .iter()
            .all(|&expression| self.file.is_evaluated_without_effect(expression))
        {
            return length;
        }
        self.set_position(self.file.construct_position(construction));
        let check = BuiltinId::CompilerHelpersCheckedArrayLength;
        self.emit_locked_call(check, None, &[length])
    }

    // Array.from({ length: n }), Array.from({ length: n }, mapper)
    pub(super) fn lower_array_from(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
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
        let length = self.file.find_written_length(items)?;
        let length = self.lower_expression(length);
        let Some(mapper) = mapper else {
            let made = self.emit_maker(call, BuiltinId::CompilerHelpersArrayOfUndefined, &[length]);
            return Some(made);
        };
        let is_written_as_function = matches!(hir[mapper].kind, ExprKind::Fn(_));
        let mut written = [self.builder.undefined(), self.lower_expression(mapper)];
        self.convert_arguments(call, &mut written);
        if is_written_as_function {
            let operands = [length, written[1]];
            let made = self.emit_maker(call, BuiltinId::CompilerHelpersArrayFromLength, &operands);
            return Some(made);
        }

        // Array.from takes undefined for no mapper at all, and the list then holds undefined: not what a mapper returns.
        let split = self.split_expression_on_type(None, written[1], TypeTable::UNDEFINED);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        self.builder.switch_to(split.taken);
        let made = self.emit_maker(call, BuiltinId::CompilerHelpersArrayOfUndefined, &[length]);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        let operands = [length, split.not_taken_value];
        let made = self.emit_maker(call, BuiltinId::CompilerHelpersArrayFromLength, &operands);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.continue_in(join);
        Some(self.builder.read_variable(result))
    }

    // Array(n).fill(value)
    fn lower_filled_array(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let file = &*self.file;
        let array = file.find_receiver(site, b"fill", BuiltinId::ArrayPrototypeFill)?;
        let length = file.find_array_of_length(array)?;
        let value = file.find_only_argument(site)?;

        let length = self.lower_length(array, length, &[value]);
        let value = self.lower_operand_of_question(call, value);
        let operands = [length, value];
        let made = self.emit_maker(call, BuiltinId::CompilerHelpersFilledArray, &operands);
        Some(made)
    }

    // Array(n).fill(value).map(mapper)
    fn lower_mapped_filled_array(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let file = &*self.file;
        let filled = file.find_receiver(site, b"map", BuiltinId::ArrayPrototypeMap)?;
        let ExprKind::Call(fill) = file.hir[filled].kind else {
            return None;
        };
        let fill = file.hir[fill];
        let array = file.find_receiver(fill, b"fill", BuiltinId::ArrayPrototypeFill)?;
        let length = file.find_array_of_length(array)?;
        let value = file.find_only_argument(fill)?;
        let mapper = file.find_only_argument(site)?;
        if !file.takes_at_most_two_operands(mapper) {
            return None;
        }

        let length = self.lower_length(array, length, &[value, mapper]);
        let value = self.lower_operand_of_question(filled, value);
        let mapper = self.lower_operand_of_question(call, mapper);
        let operands = [length, value, mapper];
        let made = self.emit_maker(call, BuiltinId::CompilerHelpersMappedFilledArray, &operands);
        Some(made)
    }

    pub(super) fn try_lower_method_call(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        self.lower_filled_array(call, site)
            .or_else(|| self.lower_mapped_filled_array(call, site))
    }
}
