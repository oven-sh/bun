use super::answers::{EnumConstant, GaveUp};
use super::queries::Queries;
use crate::atom::known;
use crate::bind::{Binding, Decl, SymFlags};
use crate::check::Checker;
use crate::fold::is_exact_power;
use crate::hir::{self, BinOp, Chain, EnumMemberId, ExprId, ExprKind, MemberKey};
use crate::program::{FileId, Sym};
use crate::types::EnumValue;

pub(in crate::check) const READS_OTHER_FILE_OR_VARIABLE: u8 = 1 << 0;
pub(in crate::check) const RESTS_ON_INEXACT_POWER: u8 = 1 << 1;
pub(in crate::check) const ALL_RUN_TIME_INPUTS: u8 =
    READS_OTHER_FILE_OR_VARIABLE | RESTS_ON_INEXACT_POWER;

pub(in crate::check) fn run_time_inputs_of_operator(
    op: Option<BinOp>,
    left: Option<EnumValue>,
    right: Option<EnumValue>,
) -> u8 {
    if op != Some(BinOp::Pow) {
        return 0;
    }
    match (left, right) {
        (Some(EnumValue::Number(base)), Some(EnumValue::Number(exponent)))
            if is_exact_power(f64::from_bits(base), f64::from_bits(exponent)) =>
        {
            0
        }
        (Some(EnumValue::Number(_) | EnumValue::String(_)) | None, _) => RESTS_ON_INEXACT_POWER,
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
        let evaluated = self.c.get_enum_member_value(file, member);
        let inputs = evaluated.run_time_inputs;
        Some(EnumConstant {
            value: evaluated.value?,
            reads_other_file_or_variable: inputs & READS_OTHER_FILE_OR_VARIABLE != 0,
            rests_on_inexact_power: inputs & RESTS_ON_INEXACT_POWER != 0,
        })
    }

    pub(super) fn rests_on_inexact_power(&mut self, member: Sym) -> bool {
        let declarations = self.files().decls_of(member);
        declarations.iter().any(|&(file, declaration)| {
            let Decl::EnumMember(member) = declaration else {
                return true;
            };
            let evaluated = self.c.get_enum_member_value(file, member);
            evaluated.value.is_none() || evaluated.run_time_inputs & RESTS_ON_INEXACT_POWER != 0
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
}

impl Checker<'_, '_> {
    pub(in crate::check) fn names_one_declaration(&self, file: FileId, entity: ExprId) -> bool {
        let named = self.resolve_constant_entity(file, entity);
        named.is_some_and(|symbol| {
            self.is_global_number(symbol) || self.files().decls_of(symbol).len() == 1
        })
    }

    fn resolve_constant_entity(&self, file: FileId, entity: ExprId) -> Option<Sym> {
        let (hir, files) = (self.hir(file), self.files());
        if has_optional_link(hir, entity) {
            return None;
        }
        let ExprKind::Index { obj, index, .. } = hir[entity].kind else {
            return self.resolve_entity_name_expression(file, entity, SymFlags::VALUE);
        };
        let (_, MemberKey::Name(name)) = hir.member_key(entity)? else {
            return None;
        };
        if hir::is_parenthesized(hir, index) || !hir::is_entity_name_expression(hir, obj) {
            return None;
        }
        let root = self.resolve_entity_name_expression(file, obj, SymFlags::VALUE)?;
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
}
