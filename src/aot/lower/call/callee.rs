use bun_sema::atom::{Atom, written_name};
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, Chain, ExprFlags, ExprId, ExprKind, FnBody, FnId, MemberKey, StmtKind};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::{FileLowering, FunctionLowering};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_callee(
        &mut self,
        callee: ExprId,
        exit: Option<BlockId>,
    ) -> Callee {
        self.lower_expected_callee(callee, exit, None)
    }

    // A built-in that the signature of the call names says more than the type the checker has for the callee.
    pub(super) fn lower_expected_callee(
        &mut self,
        callee: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let mut lowered = self.lower_callee_by_decision(callee, exit, expected);
        if let Some(builtin) = expected {
            lowered.function = self.expect_builtin(lowered.function, builtin);
        }
        lowered
    }

    fn lower_callee_by_decision(
        &mut self,
        callee: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        let inner = self.file.skip_type_syntax(callee);
        match self.file.decisions().decision(inner) {
            Decision::Unknown => {}
            Decision::GlobalPath(path) => {
                self.set_position(hir[inner].pos);
                return self.lower_global_path_callee(inner, path);
            }
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
                return Callee {
                    function: self.lower_expression(inner),
                    this: None,
                    key: None,
                    name: None,
                };
            }
        }
        let is_parenthesized = hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED);
        if self.file.is_chain_root(inner) && (exit.is_none() || is_parenthesized) {
            return self.lower_chain_callee(inner, expected);
        }
        self.lower_callee_with_exit(callee, inner, exit, expected)
    }

    fn finish_callee(
        &mut self,
        callee: ExprId,
        function: ValueId,
        expected: Option<BuiltinId>,
    ) -> ValueId {
        match expected {
            Some(_) => function,
            None => self.finish_expression(callee, function),
        }
    }

    fn lower_global_path_callee(&mut self, inner: ExprId, path: &[Atom]) -> Callee {
        let last = self.lower_global_path_holder(path);
        let name = Some(self.file.intern_atom(last.name));
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee {
                function: self.emit_locked_builtin(builtin),
                this: last.holder,
                key: None,
                name,
            };
        }
        let (function, key) = match last.holder {
            Some(holder) => {
                let key = self.file.atom_key(last.name);
                let function = self.emit_get(holder, PropertyName::Constant(key));
                (function, Some(key))
            }
            None => {
                let function = self.emit_free_name_get(last.name, false);
                (function, None)
            }
        };
        Callee {
            function: self.expect_resolved_path(inner, function),
            this: last.holder,
            key,
            name,
        }
    }

    fn lower_chain_callee(&mut self, inner: ExprId, expected: Option<BuiltinId>) -> Callee {
        let own_exit = self.create_block();
        let join = self.create_block();
        let function_variable = self.builder.create_variable(None);
        let this_variable = self.builder.create_variable(None);

        let lowered = self.lower_callee_with_exit(inner, inner, Some(own_exit), expected);
        let this = match lowered.this {
            Some(this) => this,
            None => self.builder.undefined(),
        };
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
        Callee {
            function: self.builder.read_variable(function_variable),
            this: Some(self.builder.read_variable(this_variable)),
            key: None,
            name: lowered.name,
        }
    }

    fn lower_callee_with_exit(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        match self.file.hir.member_key(inner) {
            Some((object, member_key)) => {
                self.lower_member_callee(inner, object, member_key, exit, expected)
            }
            None => self.lower_plain_callee(callee, inner, exit, expected),
        }
    }

    fn lower_member_callee(
        &mut self,
        access: ExprId,
        object: ExprId,
        member_key: MemberKey,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        let name = self.file.find_callee_name(access);
        if let Some(builtin) = find_locked_builtin(self.file, access) {
            let this = self.lower_expression(object);
            return Callee {
                function: self.emit_locked_builtin(builtin),
                this: Some(this),
                key: None,
                name,
            };
        }
        if matches!(hir[object].kind, ExprKind::Super) {
            let this = self.get_this();
            let reference = self.lower_reference(access, KeyConversion::AtAccess);
            self.set_position(hir[access].pos);
            return Callee {
                function: self.get_reference(&reference),
                this: Some(this),
                key: None,
                name,
            };
        }
        if matches!(member_key, MemberKey::PrivateName(_)) {
            let base = self.lower_member_base(access, object, exit);
            return Callee {
                function: self.emit_private_get(base, access),
                this: Some(base),
                key: None,
                name,
            };
        }
        if let Some(function) = self.lower_namespace_member(access) {
            return Callee {
                function,
                this: Some(self.lower_namespace_receiver(object)),
                key: None,
                name,
            };
        }
        if let Some(function) = self.lower_export_member(access) {
            return Callee {
                function,
                this: Some(self.lower_export_receiver(access)),
                key: None,
                name,
            };
        }
        let (base, property) = member::lower_member_operands(self, access, exit);
        let function = member::emit_member_read(self, access, base, property);
        let function = self.finish_callee(access, function, expected);
        let function = self.expect_resolved_path(access, function);
        let key = match property {
            PropertyName::Constant(key) => Some(key),
            PropertyName::Computed(_) => None,
        };
        Callee {
            function,
            this: Some(base),
            key,
            name,
        }
    }

    fn lower_plain_callee(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        if !matches!(hir[inner].kind, ExprKind::Ident(_)) {
            return Callee {
                function: self.lower_chain_base(callee, exit),
                this: None,
                key: None,
                name: None,
            };
        }
        let name = self.file.find_callee_name(inner);
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee {
                function: self.emit_locked_builtin(builtin),
                this: None,
                key: None,
                name,
            };
        }
        self.set_position(hir[inner].pos);
        let (function, this) = self.lower_identifier_callee(inner);
        Callee {
            function: self.finish_callee(inner, function, expected),
            this,
            key: None,
            name,
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // JSC reports a call at the end of its callee, which the source map takes back to this token.
    pub(in crate::lower) fn last_mapped_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(expression);
        loop {
            let next = match hir[last].kind {
                ExprKind::Index { index, .. } => index,
                ExprKind::Binary { right, .. } => right,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Await(operand) => operand,
                ExprKind::New(site) if hir[site].close_pos == u32::MAX => hir[site].callee,
                ExprKind::Fn(function) => match self.last_expression_of_body(function) {
                    Some(expression) => expression,
                    None => return hir[last].end - 1,
                },
                ExprKind::Dot { .. } => return hir.name_pos(last),
                ExprKind::Call(site) | ExprKind::New(site) => return hir[site].close_pos,
                ExprKind::Array(_) | ExprKind::Object(_) => return hir[last].end - 1,
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    // An operation JSC records no position for is reported at the last position recorded before it, which belongs to the end of the operand.
    pub(in crate::lower) fn last_reported_position(&self, operand: ExprId) -> u32 {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(operand);
        loop {
            let next = match hir[last].kind {
                ExprKind::Call(site) => return self.last_mapped_position(hir[site].callee),
                ExprKind::New(_) => return self.construct_position(last),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    return self.last_mapped_position(obj);
                }
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } => right,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Await(awaited) => awaited,
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    fn last_expression_of_body(&self, function: FnId) -> Option<ExprId> {
        let hir = self.hir;
        let statement = match hir[function].body {
            FnBody::None => return None,
            FnBody::Expr(body) => return Some(body),
            FnBody::Block(statements) => hir.ids(statements).last()?,
        };
        match hir[statement].kind {
            StmtKind::Expr(value) | StmtKind::Throw(value) => Some(value),
            StmtKind::Return(value) => value.is_some().then_some(value),
            _ => None,
        }
    }

    pub(super) fn find_callee_name(&mut self, callee: ExprId) -> Option<StringId> {
        let hir = self.hir;
        let inner = self.skip_type_syntax(callee);
        if let ExprKind::Ident(name) = hir[inner].kind {
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

    /// `a.b.c`, `this.#x`, `a?.b[key]`: a callee that consists of names, as plain Bun quotes it in "a.b.c is not a function".
    /// Answers false, with `path` in any state, for anything else and for what is too long to be worth its bytes in the executable.
    fn append_written_path(&self, expression: ExprId, path: &mut Vec<u8>) -> bool {
        const LONGEST_PATH: usize = 80;
        let hir = self.hir;
        let optional = |chain| {
            if chain == Chain::Start {
                &b"?."[..]
            } else {
                &b""[..]
            }
        };
        let inner = self.skip_type_syntax(expression);
        match hir[inner].kind {
            ExprKind::Ident(name) => self.append_identifier(inner, name, path),
            ExprKind::This => path.extend_from_slice(b"this"),
            ExprKind::Super => path.extend_from_slice(b"super"),
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                if !self.append_written_path(obj, path) {
                    return false;
                }
                path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                path.extend_from_slice(written_name(self.queries.atom_bytes(name)));
            }
            ExprKind::Index { obj, index, chain } => {
                let ExprKind::Ident(key) = hir[index].kind else {
                    return false;
                };
                if !self.append_written_path(obj, path) {
                    return false;
                }
                path.extend_from_slice(optional(chain));
                path.push(b'[');
                self.append_identifier(index, key, path);
                path.push(b']');
            }
            _ => return false,
        }
        path.len() <= LONGEST_PATH
    }

    fn append_identifier(&self, identifier: ExprId, name: Atom, path: &mut Vec<u8>) {
        if !self.append_short_binding_name(self.bound.binding(identifier), path) {
            path.extend_from_slice(self.queries.atom_bytes(name));
        }
    }
}

fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_expr(expression) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}
