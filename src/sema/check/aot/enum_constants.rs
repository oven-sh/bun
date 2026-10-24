use super::answers::{EnumConstant, GaveUp};
use super::queries::Queries;
use crate::atom::known;
use crate::bind::{Binding, Decl, SymFlags};
use crate::check::errors_enums_names::{Location, is_ambient_enum, is_declared_before_use};
use crate::fold::is_exact_power;
use crate::hir::{self, BinOp, Chain, EnumMemberId, ExprId, ExprKind, MemberKey};
use crate::program::{FileId, Sym};
use crate::types::EnumValue;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct ConstantInputs {
    other_file_or_variable: bool,
    inexact_power: bool,
}

impl ConstantInputs {
    const NONE: ConstantInputs = ConstantInputs {
        other_file_or_variable: false,
        inexact_power: false,
    };
    const UNKNOWN: ConstantInputs = ConstantInputs {
        other_file_or_variable: true,
        inexact_power: true,
    };

    fn merge(self, other: ConstantInputs) -> ConstantInputs {
        ConstantInputs {
            other_file_or_variable: self.other_file_or_variable || other.other_file_or_variable,
            inexact_power: self.inexact_power || other.inexact_power,
        }
    }

    fn with_other_file_or_variable(self, is_read: bool) -> ConstantInputs {
        ConstantInputs {
            other_file_or_variable: self.other_file_or_variable || is_read,
            ..self
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum EnumReach {
    OwnFile,
    ConstEnums,
}

fn has_optional_link(hir: &hir::File<'_>, access: ExprId) -> bool {
    let mut link = access;
    while let ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } = hir[link].kind
    {
        if matches!(chain, Chain::Start | Chain::Continue) {
            return true;
        }
        link = obj;
    }
    false
}

/// `bun run` drops a cast when it reads the text, so `(Kind as any).Late` is `Kind.Late` to it.
fn without_casts(hir: &hir::File<'_>, mut expression: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. }
    | ExprKind::Satisfies { expr, .. }
    | ExprKind::NonNull(expr) = hir[expression].kind
    {
        expression = expr;
    }
    expression
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn compute_enum_constant(
        &mut self,
        file: FileId,
        member: EnumMemberId,
    ) -> Option<EnumConstant> {
        let value = self.c.get_enum_member_value(file, member).value?;
        let inputs = self.member_inputs(file, member);
        Some(EnumConstant {
            value,
            reads_other_file_or_variable: inputs.other_file_or_variable,
            rests_on_inexact_power: inputs.inexact_power,
        })
    }

    pub(super) fn rests_on_inexact_power(&mut self, member: Sym) -> bool {
        let declarations = self.files().decls_of(member);
        declarations.iter().any(|&(file, declaration)| {
            let Decl::EnumMember(member) = declaration else {
                return true;
            };
            self.member_inputs(file, member).inexact_power
        })
    }

    pub(super) fn compute_constant_enum_access(
        &mut self,
        access: ExprId,
    ) -> Result<Option<EnumValue>, GaveUp> {
        let Some((file, member)) = self.find_accessed_enum_member(access, EnumReach::ConstEnums)
        else {
            return Ok(None);
        };
        if file == self.file && !self.is_member_seen_before_access(member, access) {
            return Ok(None);
        }
        let constant = self.compute_enum_constant(file, member);
        Ok(constant.and_then(EnumConstant::value_known_to_build))
    }

    /// `bun run` puts the value in the place of an access where its transpiler has seen the member by then.
    fn is_member_seen_before_access(&self, member: EnumMemberId, access: ExprId) -> bool {
        let hir = self.hir();
        if hir[member].pos < hir::start_of(hir, access) {
            return true;
        }
        let statements_with_enum = hir.parent(hir.parent(hir.node(member)));
        let mut around_access = hir.parent(hir.node(access));
        while around_access.is_some() {
            if around_access == statements_with_enum {
                return true;
            }
            around_access = hir.parent(around_access);
        }
        false
    }

    pub(super) fn compute_accessed_enum_member(&self, access: ExprId) -> Option<EnumMemberId> {
        let (_, member) = self.find_accessed_enum_member(access, EnumReach::OwnFile)?;
        Some(member)
    }

    fn find_accessed_enum_member(
        &self,
        access: ExprId,
        reach: EnumReach,
    ) -> Option<(FileId, EnumMemberId)> {
        let hir = self.hir();
        let (object, MemberKey::Name(name)) = hir.member_key(access)? else {
            return None;
        };
        if has_optional_link(hir, access) {
            return None;
        }
        let object = without_casts(hir, object);
        let files = self.files();
        let root = self
            .c
            .resolve_entity_name_expression(self.file, object, SymFlags::VALUE)?;
        let flags = files.flags(root);
        if !flags.intersects(SymFlags::ENUM) {
            return None;
        }
        // The value is what the file's own code says, as `bun run` inlines it: the file's role has no say.
        let is_declared_here = self.is_first_identifier_own_declaration(object);
        let is_const_enum_elsewhere =
            reach == EnumReach::ConstEnums && flags.intersects(SymFlags::CONST_ENUM);
        if !is_declared_here && !is_const_enum_elsewhere {
            return None;
        }
        let member = files.export(root, name)?;
        if !files.flags(member).intersects(SymFlags::ENUM_MEMBER)
            || !self.has_compiled_value(member, is_declared_here)
        {
            return None;
        }
        files.decls_of(member).iter().find_map(|&(file, decl)| {
            if let Decl::EnumMember(member) = decl {
                Some((file, member))
            } else {
                None
            }
        })
    }

    fn is_first_identifier_own_declaration(&self, entity_name: ExprId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        match bound.binding(hir::first_identifier(hir, entity_name)) {
            Binding::Symbol(symbol) => !bound.symbol(symbol).flags.intersects(SymFlags::ALIAS),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        }
    }

    fn has_compiled_value(&self, symbol: Sym, is_declared_here: bool) -> bool {
        self.c.is_compiled_file(self.file)
            && self.files().decls_of(symbol).iter().all(|&(file, decl)| {
                let is_in_reach = match is_declared_here {
                    true => file == self.file,
                    false => self.c.is_compiled_file(file),
                };
                let bound = self.c.bound(file);
                is_in_reach && bound.has_runtime_value(bound.declared_symbol(decl))
            })
    }

    fn member_inputs(&mut self, file: FileId, member: EnumMemberId) -> ConstantInputs {
        let key = (file, member);
        if let Some(&stored) = self.memo.enum_member_inputs.get(&key) {
            return stored;
        }
        let Some(initializer) = self.c.hir(file)[member].init.some() else {
            return self.uninitialized_member_inputs(file, member);
        };
        self.memo
            .enum_member_inputs
            .insert(key, ConstantInputs::UNKNOWN);
        let used_at = Location::Member(file, member);
        let inputs = self.expression_inputs(file, initializer, used_at);
        if self.c.ran_out_of_stack.get() {
            self.memo.enum_member_inputs.remove(&key);
        } else {
            self.memo.enum_member_inputs.insert(key, inputs);
        }
        inputs
    }

    fn uninitialized_member_inputs(
        &mut self,
        file: FileId,
        member: EnumMemberId,
    ) -> ConstantInputs {
        let hir = self.c.hir(file);
        let owner = self.c.bound(file).enum_member_owner[member.idx()];
        let mut last_initialized = None;
        let mut run = SmallVec::<[EnumMemberId; 8]>::new();
        let mut is_member_in_run = false;
        for sibling in hir[owner].members.iter() {
            if hir[sibling].init.is_none() {
                run.push(sibling);
                is_member_in_run |= sibling == member;
            } else if is_member_in_run {
                break;
            } else {
                last_initialized = Some(sibling);
                run.clear();
            }
        }
        debug_assert!(is_member_in_run);
        let inputs = match last_initialized {
            Some(initialized) => self.member_inputs(file, initialized),
            None => ConstantInputs::NONE,
        };
        if !self.c.ran_out_of_stack.get() {
            let answers = run.into_iter().map(|sibling| ((file, sibling), inputs));
            self.memo.enum_member_inputs.extend(answers);
        }
        inputs
    }

    fn expression_inputs(
        &mut self,
        file: FileId,
        root: ExprId,
        used_at: Location,
    ) -> ConstantInputs {
        let hir = self.c.hir(file);
        let mut inputs = ConstantInputs::NONE;
        let mut pending = SmallVec::<[ExprId; 8]>::new();
        pending.push(root);
        while let Some(expression) = pending.pop() {
            match hir[expression].kind {
                ExprKind::Number(_) | ExprKind::String(_) => {}
                ExprKind::Template { exprs } => pending.extend(hir.ids(exprs)),
                ExprKind::Unary { operand, .. } => pending.push(operand),
                ExprKind::Binary { op, left, right } => {
                    inputs.inexact_power |=
                        op == BinOp::Pow && !self.is_power_exact(file, left, right, used_at);
                    pending.extend([left, right]);
                }
                ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    inputs = inputs.merge(self.entity_inputs(file, expression, used_at));
                }
                _ => return ConstantInputs::UNKNOWN,
            }
            if inputs == ConstantInputs::UNKNOWN {
                break;
            }
        }
        inputs
    }

    fn is_power_exact(
        &mut self,
        file: FileId,
        base: ExprId,
        exponent: ExprId,
        used_at: Location,
    ) -> bool {
        let base = self.c.evaluate(file, base, used_at).value;
        let exponent = self.c.evaluate(file, exponent, used_at).value;
        match (base, exponent) {
            (Some(EnumValue::Number(base)), Some(EnumValue::Number(exponent))) => {
                is_exact_power(f64::from_bits(base), f64::from_bits(exponent))
            }
            (Some(EnumValue::Number(_) | EnumValue::String(_)) | None, _) => false,
        }
    }

    fn entity_inputs(&mut self, file: FileId, entity: ExprId, used_at: Location) -> ConstantInputs {
        if self.c.is_stack_low() {
            return ConstantInputs::UNKNOWN;
        }
        let Some(symbol) = self.resolve_constant_entity(file, entity) else {
            return ConstantInputs::UNKNOWN;
        };
        if self.is_global_number(symbol) {
            return ConstantInputs::NONE;
        }
        let declarations = self.files().decls_of(symbol);
        let [(of, declaration)] = declarations[..] else {
            return ConstantInputs::UNKNOWN;
        };
        let inputs = match declaration {
            Decl::EnumMember(member) => {
                let owner = self.c.bound(of).enum_member_owner[member.idx()];
                let declared = (of, self.c.hir(of).node(member));
                let has_no_own_value = is_ambient_enum(self.c.hir(of), owner)
                    || !is_declared_before_use(self.c, declared, used_at);
                self.member_inputs(of, member)
                    .with_other_file_or_variable(has_no_own_value)
            }
            Decl::Var(_) => self.constant_variable_inputs(symbol, used_at),
            _ => ConstantInputs::UNKNOWN,
        };
        inputs.with_other_file_or_variable(of != used_at.file())
    }

    fn resolve_constant_entity(&self, file: FileId, entity: ExprId) -> Option<Sym> {
        let (hir, files) = (self.c.hir(file), self.files());
        if has_optional_link(hir, entity) {
            return None;
        }
        let ExprKind::Index { obj, index, .. } = hir[entity].kind else {
            return self
                .c
                .resolve_entity_name_expression(file, entity, SymFlags::VALUE);
        };
        let (_, MemberKey::Name(name)) = hir.member_key(entity)? else {
            return None;
        };
        if hir::is_parenthesized(hir, index) || !hir::is_entity_name_expression(hir, obj) {
            return None;
        }
        let root = self
            .c
            .resolve_entity_name_expression(file, obj, SymFlags::VALUE)?;
        if !files.flags(root).intersects(SymFlags::ENUM) {
            return None;
        }
        files.export(root, name)
    }

    fn is_global_number(&self, symbol: Sym) -> bool {
        let files = self.files();
        [known::NaN, known::Infinity]
            .into_iter()
            .any(|name| files.global(name, SymFlags::VALUE) == Some(symbol))
    }

    fn constant_variable_inputs(&mut self, symbol: Sym, used_at: Location) -> ConstantInputs {
        let Some((file, declaration)) = self.c.constant_variable_declaration(symbol, used_at)
        else {
            return ConstantInputs::UNKNOWN;
        };
        let initializer = self.c.hir(file)[declaration].init;
        let location = Location::Variable(file, declaration);
        let value = self.c.evaluate(file, initializer, location).value;
        let inputs = self.expression_inputs(file, initializer, location);
        let is_inlined = self.c.is_const_inlined_by_transpiler(
            (file, declaration),
            used_at,
            value,
            inputs.other_file_or_variable,
        );
        inputs.with_other_file_or_variable(!is_inlined)
    }
}
