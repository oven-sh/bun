use super::answers::{EnumConstant, GaveUp};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, Decl, SymFlags};
use crate::check::Checker;
use crate::check::errors_enums_names::is_ambient_enum;
use crate::fold::is_exact_power;
use crate::hir::{self, BinOp, EnumMemberId, ExprFlags, ExprId, Kind, MemberKey, Node};
use crate::program::{FileId, Sym};
use crate::types::EnumValue;
use smallvec::SmallVec;

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

/// The last name of a path such as `Outer.Inner.A`.
#[derive(Copy, Clone)]
struct PathMember {
    holder: Sym,
    member: Sym,
    is_path_declared_here: bool,
}

/// What one part of a namespace exports is in scope in its other parts too, where no declaration
/// of it stands around the name.
fn is_declared_around(hir: &hir::File<'_>, declarations: &[Decl], name: ExprId) -> bool {
    let mut around = hir.parent(hir.node(name));
    while around.is_some() {
        let mut declarations = declarations.iter();
        if declarations.any(|&declaration| hir.parent(hir.node(declaration)) == around) {
            return true;
        }
        around = hir.parent(around);
    }
    false
}

/// The object and the name of one link of a path that Bun's transpiler follows: `["name"]` is
/// `.name` where the name is ASCII, and a link of an optional chain ends the path.
pub fn find_link_followed_by_transpiler<'a>(
    hir: &hir::File<'_>,
    link: ExprId,
    bytes_of: impl FnOnce(Atom) -> &'a [u8],
) -> Option<(ExprId, Atom)> {
    let (object, MemberKey::Name(name)) = hir.member_key(link)? else {
        return None;
    };
    let is_optional = hir
        .expr_flags(link)
        .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
    let is_followed = !is_optional && hir.is_name_resolved_by_transpiler(link, bytes_of(name));
    is_followed.then_some((object, name))
}

/// Bun's transpiler visits the enums of a list of statements ahead of the list's other statements,
/// and knows a member's value from that visit on.
pub fn is_member_visited_before(hir: &hir::File<'_>, member: EnumMemberId, access: ExprId) -> bool {
    let count_ancestors = |mut node: Node| {
        let mut count = 0usize;
        while node.is_some() {
            node = hir.parent(node);
            count += 1;
        }
        count
    };
    let (mut toward_member, mut toward_access) = (hir.node(member), hir.node(access));
    let (above_member, above_access) = (
        count_ancestors(toward_member),
        count_ancestors(toward_access),
    );
    for _ in above_access..above_member {
        toward_member = hir.parent(toward_member);
    }
    for _ in above_member..above_access {
        toward_access = hir.parent(toward_access);
    }
    while hir.parent(toward_member) != hir.parent(toward_access) {
        toward_member = hir.parent(toward_member);
        toward_access = hir.parent(toward_access);
    }
    let is_enum = |node: Node| hir.kind(node) == Kind::EnumDeclaration;
    match (is_enum(toward_member), is_enum(toward_access)) {
        (true, false) => true,
        (false, true) => false,
        (true, true) | (false, false) => hir[member].pos < hir::start_of(hir, access),
    }
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
        if file == self.file && !is_member_visited_before(self.hir(), member, access) {
            return Ok(None);
        }
        let constant = self.compute_enum_constant(file, member);
        Ok(constant.and_then(EnumConstant::value_known_to_build))
    }

    pub(super) fn compute_accessed_enum_member(&self, access: ExprId) -> Option<EnumMemberId> {
        let (_, member) = self.find_accessed_enum_member(access, EnumReach::OwnFile)?;
        is_member_visited_before(self.hir(), member, access).then_some(member)
    }

    fn find_accessed_enum_member(
        &self,
        access: ExprId,
        reach: EnumReach,
    ) -> Option<(FileId, EnumMemberId)> {
        let files = self.files();
        let PathMember {
            holder,
            member,
            is_path_declared_here: is_declared_here,
        } = self.c.resolve_member_path(self.file, access)?;
        let flags = files.flags(holder);
        let is_const_enum_elsewhere =
            reach == EnumReach::ConstEnums && flags.intersects(SymFlags::CONST_ENUM);
        if !is_declared_here && !is_const_enum_elsewhere {
            return None;
        }
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
    /// A file that is read for its types alone has no code, so nothing in it waits for a run time.
    pub(in crate::check) fn is_left_to_run_time(&self, file: FileId, entity: ExprId) -> bool {
        self.is_compiled_file(file) && !self.names_one_declaration(file, entity)
    }

    fn names_one_declaration(&self, file: FileId, entity: ExprId) -> bool {
        let named = self.resolve_constant_entity(file, entity);
        named.is_some_and(|symbol| {
            self.is_global_number(symbol) || self.files().decls_of(symbol).len() == 1
        })
    }

    fn resolve_constant_entity(&self, file: FileId, entity: ExprId) -> Option<Sym> {
        if self.hir(file).member_key(entity).is_none() {
            return self.resolve_entity_name_expression(file, entity, SymFlags::VALUE);
        }
        let named = self.resolve_member_path(file, entity)?;
        let (hir, owners) = (self.hir(file), &self.bound(file).enum_member_owner);
        let declarations = self.files().decls_of(named.member);
        let has_own_value = |&(declared_in, declaration): &(FileId, Decl)| {
            let Decl::EnumMember(member) = declaration else {
                return true;
            };
            declared_in == file && !is_ambient_enum(hir, owners[member.idx()])
        };
        if named.member.file != file || !declarations.iter().all(has_own_value) {
            return Some(named.member);
        }
        let is_known_to_transpiler = named.is_path_declared_here
            && declarations.iter().all(|&(declared_in, declaration)| {
                let Decl::EnumMember(member) = declaration else {
                    return true;
                };
                declared_in != file || is_member_visited_before(hir, member, entity)
            });
        is_known_to_transpiler.then_some(named.member)
    }

    /// Follows a path the way Bun's transpiler does: the first name is what it is bound to as a
    /// value, `["name"]` is `.name`, and parentheses and type assertions do not count.
    fn resolve_member_path(&self, file: FileId, path: ExprId) -> Option<PathMember> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut first = path;
        while hir.member_key(first).is_some() {
            let atoms = self.atoms();
            let link = find_link_followed_by_transpiler(hir, first, |name| atoms.bytes(name));
            let (object, name) = link?;
            names.push(name);
            first = hir.skip_type_assertions(object);
        }
        if names.is_empty() {
            return None;
        }
        let root = self.resolve_entity_name_expression(file, first, SymFlags::VALUE)?;
        let mut end = PathMember {
            holder: root,
            member: root,
            is_path_declared_here: true,
        };
        for &name in names.iter().rev() {
            end.holder = end.member;
            if !files.flags(end.holder).intersects(SymFlags::NAMESPACE) {
                return None;
            }
            let link = files.namespace_member(end.holder, name)?;
            end.is_path_declared_here &= !files.flags(link).intersects(SymFlags::ALIAS);
            end.member = files.canonical(files.resolve_alias_as(link, SymFlags::VALUE)?);
        }
        end.is_path_declared_here &= match bound.binding(first) {
            Binding::Symbol(symbol) => {
                let symbol = bound.symbol(symbol);
                !symbol.flags.intersects(SymFlags::ALIAS)
                    && is_declared_around(hir, symbol.decls, first)
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        };
        Some(end)
    }

    fn is_global_number(&self, symbol: Sym) -> bool {
        let files = self.files();
        [known::NaN, known::Infinity]
            .into_iter()
            .any(|name| files.global(name, SymFlags::VALUE) == Some(symbol))
    }
}
