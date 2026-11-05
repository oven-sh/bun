#[cfg(test)]
mod tests;

use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::CommonJsVariable;
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, Call, Chain, ExprFlags, ExprId, ExprKind, MemberKey, NodeData};
use bun_sema::import_sites::find_module_printed_as_require;

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::load::test_runner_names::skip_to_written_use;
use crate::lower::commonjs::BodyForm;
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::quoted_text::{append_printed_name, append_printed_number, append_printed_text};
use crate::lower::{FileLowering, FunctionLowering};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn leave_chain_if_nullish(
        &mut self,
        site: Call,
        function: ValueId,
        exit: Option<BlockId>,
    ) -> ValueId {
        match site.chain {
            Chain::Start => {
                let exit = exit.expect("an optional call has the exit of its chain");
                self.branch_if_expression_nullish(site.callee, function, exit)
            }
            Chain::No | Chain::Continue => function,
        }
    }

    pub(in crate::lower) fn lower_callee(
        &mut self,
        callee: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        let inner = self.file.skip_type_syntax(callee);
        let is_parenthesized = hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED);
        let mut lowered = match self.file.decisions().decision(inner) {
            Decision::Unknown
                if self.file.is_chain_root(inner) && (exit.is_none() || is_parenthesized) =>
            {
                self.lower_chain_callee(inner)
            }
            Decision::Unknown => self.lower_callee_with_exit(callee, inner, exit),
            Decision::GlobalPath(path) => {
                self.set_position(hir[inner].pos);
                self.lower_global_path_callee(inner, path)
            }
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
                Callee::without_key(self.lower_expression(inner), None, None)
            }
        };
        if let Some(builtin) = expected {
            lowered.function = self.expect_builtin(lowered.function, builtin);
        }
        lowered
    }

    fn lower_global_path_callee(&mut self, inner: ExprId, path: &[Atom]) -> Callee {
        let last = self.lower_global_path_holder(inner, path);
        let name = Some(self.file.intern_atom(last.name));
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee::without_key(self.emit_locked_builtin(builtin), last.holder, name);
        }
        let (function, key) = match last.holder {
            Some(holder) => {
                let key = self.file.atom_key(last.name);
                let function = self.emit_get(holder, PropertyName::Constant(key));
                (function, Some(key))
            }
            None => (self.get_root_of_global_path(inner, last.name), None),
        };
        Callee {
            function: self.expect_resolved_path(inner, function),
            this: last.holder,
            key,
            name,
        }
    }

    fn lower_chain_callee(&mut self, inner: ExprId) -> Callee {
        let own_exit = self.create_block();
        let join = self.create_block();
        let function_variable = self.builder.create_variable(None);
        let this_variable = self.builder.create_variable(None);

        let lowered = self.lower_callee_with_exit(inner, inner, Some(own_exit));
        let this = lowered.this.unwrap_or_else(|| self.builder.undefined());
        self.builder
            .write_variable(function_variable, lowered.function);
        self.builder.write_variable(this_variable, this);
        self.jump(join);

        self.continue_in(own_exit);
        let undefined = self.builder.undefined();
        self.builder.write_variable(function_variable, undefined);
        self.builder.write_variable(this_variable, undefined);
        self.jump(join);

        self.continue_in(join);
        let function = self.builder.read_variable(function_variable);
        let this = self.builder.read_variable(this_variable);
        Callee::without_key(function, Some(this), lowered.name)
    }

    fn lower_callee_with_exit(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
    ) -> Callee {
        let (hir, bound) = (self.file.hir, self.file.bound);
        if let Some(module) = find_module_printed_as_require(hir, bound, inner) {
            return self.lower_module_require_callee(inner, module, exit);
        }
        match hir.member_key(inner) {
            Some((object, member_key)) => self.lower_member_callee(inner, object, member_key, exit),
            None => self.lower_plain_callee(callee, inner, exit),
        }
    }

    fn lower_module_require_callee(
        &mut self,
        access: ExprId,
        module: ExprId,
        exit: Option<BlockId>,
    ) -> Callee {
        match self.file.body_form() {
            BodyForm::NotCommonJs | BodyForm::Plain => {
                self.set_position(self.file.hir[module].pos);
                let function = self.get_commonjs_variable(CommonJsVariable::Require);
                let name = Some(self.file.intern_atom(known::require));
                Callee::without_key(function, None, name)
            }
            BodyForm::Wrapped => {
                let name = self.file.find_callee_name(access);
                self.lower_ordinary_member_callee(access, exit, name)
            }
        }
    }

    fn lower_member_callee(
        &mut self,
        access: ExprId,
        object: ExprId,
        member_key: MemberKey,
        exit: Option<BlockId>,
    ) -> Callee {
        let hir = self.file.hir;
        let name = self.file.find_callee_name(access);
        if let Some(builtin) = find_locked_builtin(self.file, access) {
            let this = self.lower_expression(object);
            return Callee::without_key(self.emit_locked_builtin(builtin), Some(this), name);
        }
        if matches!(hir[object].kind, ExprKind::Super) {
            let this = self.get_this();
            let reference = self.lower_reference(access, KeyConversion::AtAccess);
            self.set_position(hir[access].pos);
            return Callee::without_key(self.get_reference(&reference), Some(this), name);
        }
        if matches!(member_key, MemberKey::PrivateName(_)) {
            let base = self.lower_member_base(access, object, exit);
            return Callee::without_key(self.emit_private_get(base, access), Some(base), name);
        }
        if let Some(function) = self.lower_namespace_member(access) {
            let this = self.lower_namespace_receiver(object);
            return Callee::without_key(function, Some(this), name);
        }
        if let Some(function) = self.lower_export_member(access) {
            let this = self.lower_export_receiver(access);
            return Callee::without_key(function, Some(this), name);
        }
        let modules = self.file.inputs.modules;
        if modules.answer_member(self.file.file, access).is_some() {
            let this = self.lower_member_base(access, object, exit);
            let function = self.lower_callee_of_answer(access, Some(this));
            return Callee::without_key(function, Some(this), name);
        }
        if let Some(constant) = self.file.find_enum_member_read(access) {
            if let Some(member) = self.file.find_member_of_loaded_module(access) {
                self.check_member_root(member);
            }
            return Callee::without_key(self.emit_constant(constant), None, name);
        }
        self.lower_ordinary_member_callee(access, exit, name)
    }

    fn lower_callee_of_answer(&mut self, access: ExprId, base: Option<ValueId>) -> ValueId {
        let (function, on_answer) = self.lower_member_of_answer_below(access, base);
        self.callees_read_on_answers.insert(function, on_answer);
        function
    }

    fn find_member_of_answer_behind_number(&self, callee: ExprId) -> Option<ExprId> {
        let hir = self.file.hir;
        let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } = hir[callee].kind
        else {
            return None;
        };
        let (left, access) = (
            self.file.skip_type_syntax(left),
            self.file.skip_type_syntax(right),
        );
        let modules = self.file.inputs.modules;
        let is_found = matches!(hir[left].kind, ExprKind::Number(_))
            && modules.answer_member(self.file.file, access).is_some();
        is_found.then_some(access)
    }

    fn lower_ordinary_member_callee(
        &mut self,
        access: ExprId,
        exit: Option<BlockId>,
        name: Option<StringId>,
    ) -> Callee {
        let (base, property) = member::lower_member_operands(self, access, exit);
        let function = member::emit_member_read(self, access, base, property);
        let function = self.expect_resolved_path(access, function);
        Callee {
            function,
            this: Some(base),
            key: property.key_operands().1,
            name,
        }
    }

    fn find_name_behind_choice_of_build(&self, callee: ExprId) -> Option<ExprId> {
        let file = &*self.file;
        let written = skip_to_written_use(file.hir, |name| file.queries.atom_bytes(name), callee);
        let scope = file.bound.dynamic_lookup_scope(NodeData::Expr(written));
        (written != callee && scope.is_some()).then_some(written)
    }

    fn lower_callee_chosen_by_build(&mut self, choice: ExprId, written: ExprId) -> Callee {
        let name = self.file.find_callee_name(written);
        let join = self.create_block();
        let function_variable = self.builder.create_variable(None);
        let this_variable = self.builder.create_variable(None);
        self.lower_conditional_arms(choice, false, &mut |lowering, arm| {
            let arm = lowering.file.skip_type_syntax(arm);
            lowering.set_position(lowering.file.hir[arm].pos);
            let (function, this) = lowering.lower_identifier_callee(arm);
            let this = this.unwrap_or_else(|| lowering.builder.undefined());
            lowering.builder.write_variable(function_variable, function);
            lowering.builder.write_variable(this_variable, this);
            lowering.jump(join);
        });
        self.continue_in(join);
        let function = self.builder.read_variable(function_variable);
        let this = self.builder.read_variable(this_variable);
        Callee::without_key(function, Some(this), name)
    }

    fn lower_plain_callee(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
    ) -> Callee {
        let hir = self.file.hir;
        if let Some(access) = self.find_member_of_answer_behind_number(inner) {
            let function = self.lower_callee_of_answer(access, None);
            return Callee::without_key(function, None, None);
        }
        if let Some(written) = self.find_name_behind_choice_of_build(inner) {
            return self.lower_callee_chosen_by_build(inner, written);
        }
        if !matches!(hir[inner].kind, ExprKind::Ident(_)) {
            let name = match hir[inner].kind {
                ExprKind::Await(_) => self.file.find_callee_name(inner),
                _ => None,
            };
            return Callee::without_key(self.lower_chain_base(callee, exit), None, name);
        }
        let name = self.file.find_callee_name(inner);
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee::without_key(self.emit_locked_builtin(builtin), None, name);
        }
        self.set_position(hir[inner].pos);
        let (function, this) = self.lower_identifier_callee(inner);
        Callee::without_key(function, this, name)
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn find_callee_name(&mut self, callee: ExprId) -> Option<StringId> {
        let hir = self.hir;
        let inner = self.skip_type_syntax(callee);
        if let ExprKind::Ident(name) = hir[inner].kind
            && self.queries.atom_bytes(name).is_ascii()
        {
            return Some(self.intern_binding_name(self.bound.binding(inner), name));
        }
        let mut path = Vec::new();
        if self.append_written_path(inner, &mut path) {
            return Some(self.intern_bytes(&path));
        }
        match hir.member_key(inner) {
            Some((_, MemberKey::Name(name))) => Some(self.intern_atom(name)),
            Some((_, MemberKey::PrivateName(name))) => {
                let text = written_name(self.queries.atom_bytes(name));
                Some(self.intern_bytes(text))
            }
            Some((_, MemberKey::Computed(_))) | None => None,
        }
    }

    fn append_written_path(&self, expression: ExprId, path: &mut Vec<u8>) -> bool {
        const LONGEST_PATH: usize = 80;
        let hir = self.hir;
        let inner = self.skip_type_syntax(expression);
        match hir[inner].kind {
            ExprKind::Ident(name) => self.append_identifier(inner, name, path),
            ExprKind::This => path.extend_from_slice(b"this"),
            ExprKind::Super => path.extend_from_slice(b"super"),
            ExprKind::ImportMeta => path.extend_from_slice(b"import.meta"),
            ExprKind::Await(mut awaited) => {
                path.extend_from_slice(b"(await ");
                while let ExprKind::Await(next) = hir[self.skip_type_syntax(awaited)].kind {
                    path.extend_from_slice(b"await ");
                    awaited = next;
                }
                if !self.append_written_path(awaited, path) {
                    return false;
                }
                path.push(b')');
            }
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                if !self.append_written_path(obj, path) {
                    return false;
                }
                let name = self.queries.atom_bytes(name);
                if hir.is_name_resolved_by_transpiler(inner, name) {
                    path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                    append_printed_name(written_name(name), path);
                } else {
                    path.extend_from_slice(if chain == Chain::Start { b"?.[" } else { b"[" });
                    append_printed_text(name, path);
                    path.push(b']');
                }
            }
            ExprKind::Index { obj, index, chain } => {
                if !self.append_written_path(obj, path) {
                    return false;
                }
                path.extend_from_slice(if chain == Chain::Start { b"?.[" } else { b"[" });
                match (hir[index].kind, hir.index_member_key(index)) {
                    (ExprKind::Ident(key), _) => self.append_identifier(index, key, path),
                    (ExprKind::Number(key), _) if hir.numbers[key as usize].is_finite() => {
                        append_printed_number(hir.numbers[key as usize], path);
                    }
                    (_, MemberKey::Name(key)) => {
                        append_printed_text(self.queries.atom_bytes(key), path);
                    }
                    _ => return false,
                }
                path.push(b']');
            }
            _ => return false,
        }
        path.len() <= LONGEST_PATH
    }
}

fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_pure_expr(expression) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}
