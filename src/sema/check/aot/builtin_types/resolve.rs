use super::{BuiltinTypeClass, BuiltinTypePath, BuiltinValueIndex, BuiltinValuePath, Denotation};
use crate::atom::Atom;
use crate::bind::{Decl, PatParent, ScopeId, SymFlags};
use crate::check::aot::answers::FunctionRef;
use crate::hir::{
    ExprId, ExprKind, File, FileKind, Flags, FnBody, FnId, MemberId, MemberKind, PropKey, Span,
    TypeNodeId, TypeNodeKind, is_entity_name_expression,
};
use crate::program::{FileId, Files, Sym};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::hash_map::Entry;

type TypeClasses = FxHashMap<Sym, BuiltinTypeClass>;
type EntityName = SmallVec<[Atom; 4]>;

pub(super) fn resolve_type_classes(
    files: &Files<'_>,
    types: &[BuiltinTypePath<'_>],
) -> FxHashMap<Sym, BuiltinTypeClass> {
    let mut classes = TypeClasses::default();
    for path in types {
        let Some(symbol) = find_symbol(files, path.module, path.names, SymFlags::TYPE) else {
            continue;
        };
        if has_runtime_declaration(files, symbol) {
            continue;
        }
        match classes.entry(symbol) {
            Entry::Occupied(first) => debug_assert_eq!(first.get().class, path.class),
            Entry::Vacant(vacant) => {
                vacant.insert(BuiltinTypeClass {
                    class: path.class,
                    type_name: path.type_name,
                    denotation: path.denotation,
                });
            }
        }
    }
    degrade_types_with_unknown_subtypes(files, &mut classes);
    classes
}

pub(super) fn collect_call_signatures(
    files: &Files<'_>,
    values: &[BuiltinValuePath<'_>],
) -> FxHashMap<FunctionRef, BuiltinValueIndex> {
    let mut call_signatures = FxHashMap::default();
    for path in values {
        let Some(value) = find_symbol(files, path.module, path.names, SymFlags::VALUE) else {
            continue;
        };
        if has_runtime_declaration(files, value) {
            continue;
        }
        for signature in collect_value_signatures(files, value) {
            call_signatures.entry(signature).or_insert(path.value);
        }
    }
    call_signatures
}

fn find_symbol(
    files: &Files<'_>,
    module: Option<&str>,
    names: &[&str],
    meaning: SymFlags,
) -> Option<Sym> {
    let (&last, holders) = names.split_last()?;
    let mut holder = match module {
        Some(module) => {
            let specifier = files.atoms.lookup(module.as_bytes())?;
            Some(files.try_find_ambient_module(specifier)?)
        }
        None => None,
    };
    for &name in holders {
        holder = Some(find_member(
            files,
            holder,
            name,
            meaning | SymFlags::NAMESPACE,
        )?);
    }
    find_member(files, holder, last, meaning)
}

fn find_member(
    files: &Files<'_>,
    holder: Option<Sym>,
    name: &str,
    meaning: SymFlags,
) -> Option<Sym> {
    let name = files.atoms.lookup(name.as_bytes())?;
    let member = match holder {
        None => files.global(name, meaning)?,
        Some(holder) => files
            .namespace_member(holder, name)
            .or_else(|| files.member(find_annotated_type_symbol(files, holder)?, name))?,
    };
    let member = files.canonical(files.resolve_alias_as(member, meaning)?);
    files.flags(member).intersects(meaning).then_some(member)
}

fn has_runtime_declaration(files: &Files<'_>, symbol: Sym) -> bool {
    let declarations = files.decls_of(symbol);
    let mut declarations = declarations.iter();
    declarations.any(|&(file, declaration)| is_runtime_declaration(files, file, declaration))
}

fn is_runtime_declaration(files: &Files<'_>, file: FileId, declaration: Decl) -> bool {
    let hir = files.hir(file);
    if hir.kind == FileKind::Declaration {
        return false;
    }
    match declaration {
        Decl::Class(_) | Decl::Var(_) => {
            let flags = files.bound(file).modifier_flags(hir, declaration);
            !flags.contains(Flags::AMBIENT)
        }
        Decl::Fn(function) => match hir[function].body {
            FnBody::Block(_) | FnBody::Expr(_) => true,
            FnBody::None => false,
        },
        _ => false,
    }
}

#[derive(Default)]
struct HeritageEdges {
    unknown_subtype_bases: Vec<Sym>,
    builtin_subtype_bases: FxHashMap<Sym, SmallVec<[Sym; 2]>>,
}

impl HeritageEdges {
    fn add(&mut self, classes: &TypeClasses, subtype: Sym, base: Sym) {
        if !classes.contains_key(&base) {
            return;
        }
        if classes.contains_key(&subtype) {
            let bases = self.builtin_subtype_bases.entry(subtype).or_default();
            bases.push(base);
        } else {
            self.unknown_subtype_bases.push(base);
        }
    }
}

fn describes_values_outside_table(files: &Files<'_>, file: FileId) -> bool {
    files.hir(file).kind == FileKind::Declaration && !files.module(file).is_lib
}

fn degrade_types_with_unknown_subtypes(files: &Files<'_>, classes: &mut TypeClasses) {
    let mut denotations = classes.values().map(|class| class.denotation);
    if !denotations.any(|denotation| denotation == Denotation::Exact) {
        return;
    }
    let mut edges = HeritageEdges::default();
    for &file in files.order {
        if describes_values_outside_table(files, file) {
            collect_heritage_edges(files, file, classes, &mut edges);
        }
    }
    let mut pending = edges.unknown_subtype_bases;
    let mut visited = FxHashSet::default();
    while let Some(symbol) = pending.pop() {
        if !visited.insert(symbol) {
            continue;
        }
        if let Some(class) = classes.get_mut(&symbol) {
            class.denotation = Denotation::View;
        }
        if let Some(bases) = edges.builtin_subtype_bases.get(&symbol) {
            pending.extend_from_slice(bases);
        }
    }
}

fn collect_heritage_edges(
    files: &Files<'_>,
    file: FileId,
    classes: &TypeClasses,
    edges: &mut HeritageEdges,
) {
    let (hir, bound) = (files.hir(file), files.bound(file));
    for (interface, symbol) in hir.interfaces.iter().zip(bound.interface_symbol.iter()) {
        let Some(symbol) = symbol.some() else {
            continue;
        };
        for node in hir.ids(interface.extends) {
            if let Some(base) = find_referenced_type_symbol(files, file, node) {
                edges.add(classes, files.sym(file, symbol), base);
            }
        }
    }
    for (class, symbol) in hir.classes.iter().zip(bound.class_symbol.iter()) {
        let Some(symbol) = symbol.some() else {
            continue;
        };
        let extended = find_extended_type_symbol(files, file, class.extends);
        let implemented = hir
            .ids(class.implements)
            .filter_map(|node| find_referenced_type_symbol(files, file, node));
        for base in extended.into_iter().chain(implemented) {
            edges.add(classes, files.sym(file, symbol), base);
        }
    }
}

fn extends_builtin_type(
    files: &Files<'_>,
    classes: &TypeClasses,
    symbol: Sym,
    known: &mut FxHashMap<Sym, bool>,
) -> bool {
    if classes.contains_key(&symbol) {
        return true;
    }
    if let Some(&extends) = known.get(&symbol) {
        return extends;
    }
    known.insert(symbol, false);
    let mut extends = false;
    for &(file, declaration) in files.decls_of(symbol).iter() {
        let Decl::Interface(interface) = declaration else {
            continue;
        };
        let hir = files.hir(file);
        for node in hir.ids(hir[interface].extends) {
            extends |= find_referenced_type_symbol(files, file, node)
                .is_some_and(|base| extends_builtin_type(files, classes, base, known));
        }
    }
    known.insert(symbol, extends);
    extends
}

pub(super) fn collect_program_subtypes(files: &Files<'_>, classes: &TypeClasses) -> Vec<Sym> {
    let mut known = FxHashMap::default();
    let mut listed = FxHashSet::default();
    let mut subtypes = Vec::new();
    for &file in files.order {
        if files.hir(file).kind == FileKind::Declaration {
            continue;
        }
        for symbol in files.bound(file).interface_symbol.iter() {
            let Some(symbol) = symbol.some() else {
                continue;
            };
            let symbol = files.canonical(files.sym(file, symbol));
            if !classes.contains_key(&symbol)
                && extends_builtin_type(files, classes, symbol, &mut known)
                && listed.insert(symbol)
            {
                subtypes.push(symbol);
            }
        }
    }
    subtypes
}

pub(super) fn collect_static_members(files: &Files<'_>) -> FxHashMap<Atom, SmallVec<[Sym; 2]>> {
    let mut classes: FxHashMap<Atom, SmallVec<[Sym; 2]>> = FxHashMap::default();
    for &file in files.order {
        let hir = files.hir(file);
        if hir.kind == FileKind::Declaration {
            continue;
        }
        for (class, symbol) in hir
            .classes
            .iter()
            .zip(files.bound(file).class_symbol.iter())
        {
            let Some(symbol) = symbol.some() else {
                continue;
            };
            let symbol = files.canonical(files.sym(file, symbol));
            for name in static_member_names(hir, class.members) {
                let declaring = classes.entry(name).or_default();
                if !declaring.contains(&symbol) {
                    declaring.push(symbol);
                }
            }
        }
    }
    classes
}

fn static_member_names(hir: &File<'_>, members: Span<MemberId>) -> impl Iterator<Item = Atom> {
    members.iter().filter_map(|member| match hir[member].key {
        PropKey::Name(name) if hir[member].flags.contains(Flags::STATIC) => Some(name),
        _ => None,
    })
}

pub(super) fn can_list_declarations_of(files: &Files<'_>, file: FileId) -> bool {
    let hir = files.hir(file);
    let mut interfaces = hir.interfaces.iter();
    let mut classes = hir.classes.iter();
    hir.kind != FileKind::Declaration
        && (interfaces.any(|interface| !interface.extends.is_empty())
            || classes.any(|class| static_member_names(hir, class.members).next().is_some()))
}

fn find_referenced_type_symbol(files: &Files<'_>, file: FileId, node: TypeNodeId) -> Option<Sym> {
    let hir = files.hir(file);
    let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
        return None;
    };
    let name: EntityName = hir.texts(name).collect();
    resolve_type_name(files, file, files.bound(file).type_scope[node.idx()], &name)
}

fn find_extended_type_symbol(files: &Files<'_>, file: FileId, extends: ExprId) -> Option<Sym> {
    let expression = extends.some()?;
    let name = collect_entity_name(files.hir(file), expression)?;
    let &scope = files.bound(file).expr_scope.get(&expression)?;
    resolve_type_name(files, file, scope, &name)
}

fn collect_entity_name(hir: &File<'_>, expression: ExprId) -> Option<EntityName> {
    if !is_entity_name_expression(hir, expression) {
        return None;
    }
    let mut names = EntityName::new();
    let mut object = expression;
    while let ExprKind::Dot { obj, name, .. } = hir[object].kind {
        names.push(name);
        object = obj;
    }
    let ExprKind::Ident(root) = hir[object].kind else {
        return None;
    };
    names.push(root);
    names.reverse();
    Some(names)
}

fn resolve_type_name(
    files: &Files<'_>,
    file: FileId,
    scope: ScopeId,
    name: &[Atom],
) -> Option<Sym> {
    let named = files.resolve_entity(file, scope.some()?, name, SymFlags::TYPE)?;
    Some(files.canonical(files.resolve_alias_as(named, SymFlags::TYPE)?))
}

enum DeclaredSignature {
    Function(FnId),
    Annotation(TypeNodeId),
    Unknown,
}

fn find_declared_signature(
    files: &Files<'_>,
    file: FileId,
    declaration: Decl,
) -> DeclaredSignature {
    let hir = files.hir(file);
    let annotation = match declaration {
        Decl::Fn(function) => return DeclaredSignature::Function(function),
        Decl::Var(pattern) => match files.bound(file).pat_parent[pattern.idx()] {
            PatParent::Var(declarator) => hir[declarator].ty,
            PatParent::None | PatParent::Param(_) | PatParent::Prop(..) | PatParent::Elem(..) => {
                return DeclaredSignature::Unknown;
            }
        },
        Decl::Member(member) => match hir[member].kind {
            MemberKind::Method => return DeclaredSignature::Function(hir[member].func),
            MemberKind::Property => hir[member].ty,
            _ => return DeclaredSignature::Unknown,
        },
        _ => return DeclaredSignature::Unknown,
    };
    match annotation.some() {
        Some(annotation) => DeclaredSignature::Annotation(annotation),
        None => DeclaredSignature::Unknown,
    }
}

fn find_annotated_type_symbol(files: &Files<'_>, value: Sym) -> Option<Sym> {
    let (file, declaration) = files.value_declaration(value)?;
    match find_declared_signature(files, file, declaration) {
        DeclaredSignature::Annotation(node) => find_referenced_type_symbol(files, file, node),
        DeclaredSignature::Function(_) | DeclaredSignature::Unknown => None,
    }
}

fn collect_value_signatures(files: &Files<'_>, value: Sym) -> SmallVec<[FunctionRef; 4]> {
    let mut signatures = SmallVec::new();
    for &(file, declaration) in files.decls_of(value).iter() {
        match find_declared_signature(files, file, declaration) {
            DeclaredSignature::Function(function) => {
                signatures.push(FunctionRef { file, function });
            }
            DeclaredSignature::Annotation(_) | DeclaredSignature::Unknown => {}
        }
    }
    let Some(declared_type) = find_annotated_type_symbol(files, value) else {
        return signatures;
    };
    for &(file, declaration) in files.decls_of(declared_type).iter() {
        let Decl::Interface(interface) = declaration else {
            continue;
        };
        let hir = files.hir(file);
        for member in hir[interface].members.iter().map(|member| hir[member]) {
            if member.kind == MemberKind::CallSignature {
                let function = member.func;
                signatures.push(FunctionRef { file, function });
            }
        }
    }
    signatures
}

#[cfg(test)]
mod tests;
