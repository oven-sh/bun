use crate::atom::{Atom, known};
use crate::bind::{Decl, PatParent, SymFlags};
use crate::check::Checker;
use crate::check::aot::DiagnosticClass;
use crate::check::errors_names_and_exports::root_declaration;
use crate::check::explain::NOWHERE;
use crate::check::sink::{Arg, Reported};
use crate::hir::{ExprId, ExprKind, FnBody, FnId, MemberKind, Node, NodeData, StmtKind};
use crate::program::{FileId, Files, Sym};
use crate::types::{Origin, PropSource, SigId, TypeData, TypeId};
use smallvec::SmallVec;

type SeenExpressions = SmallVec<[(FileId, ExprId); 8]>;

const MOST_EXPRESSIONS_FOLLOWED: usize = 64;

const MOST_CLASSES_CLIMBED: usize = 16;

const STORE_TO_WHAT_TAKES_NO_STORE_CODES: [u32; 6] = [2588, 2628, 2629, 2630, 2631, 2632];

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum DiagnosticSubject {
    #[default]
    None,
    ModuleSpecifier(Atom),
    MemberContainer(Sym),
    BroughtDeclaration,
}

impl DiagnosticSubject {
    pub fn or(self, other: DiagnosticSubject) -> DiagnosticSubject {
        match self {
            DiagnosticSubject::None => other,
            DiagnosticSubject::ModuleSpecifier(_)
            | DiagnosticSubject::MemberContainer(_)
            | DiagnosticSubject::BroughtDeclaration => self,
        }
    }
}

pub fn containers_completed_by_bun_types(files: &Files<'_>) -> [Option<Sym>; 4] {
    let bun_module = files
        .atoms
        .lookup(b"bun")
        .and_then(|specifier| files.try_find_ambient_module(specifier));
    let import_meta = files
        .global_type_symbol(known::ImportMeta)
        .map(|symbol| files.canonical(symbol));
    let error_constructor = files
        .atoms
        .lookup(b"ErrorConstructor")
        .and_then(|name| files.global_type_symbol(name))
        .map(|symbol| files.canonical(symbol));
    let node_namespace = files
        .atoms
        .lookup(b"NodeJS")
        .and_then(|name| files.global(name, SymFlags::NAMESPACE))
        .map(|symbol| files.canonical(symbol));
    [bun_module, import_meta, error_constructor, node_namespace]
}

impl Checker<'_, '_> {
    pub(in crate::check) fn subject_of_arguments(&self, args: &[Arg<'_>]) -> DiagnosticSubject {
        if !self.files().brings_declarations() {
            return DiagnosticSubject::None;
        }
        let is_brought = args.iter().any(|arg| match *arg {
            Arg::Type(ty) => self.is_type_brought(ty, 0),
            Arg::Sym(symbol) => self.files().is_brought(symbol.file),
            Arg::Sig(signature) => self.is_signature_brought(signature),
            Arg::Prop(_)
            | Arg::Atom(_)
            | Arg::Number(_)
            | Arg::Bytes(_)
            | Arg::Text(_)
            | Arg::Path(_) => false,
        });
        match is_brought {
            true => DiagnosticSubject::BroughtDeclaration,
            false => DiagnosticSubject::None,
        }
    }

    fn is_type_brought(&self, ty: TypeId, depth: u32) -> bool {
        let files = self.files();
        if (self.alias_symbol_of_type(ty)).is_some_and(|alias| files.is_brought(alias.file)) {
            return true;
        }
        match self.data(ty) {
            TypeData::Ref { target: symbol, .. }
            | TypeData::Enum { symbol, .. }
            | TypeData::EnumLit { member: symbol, .. }
            | TypeData::ThisParam(symbol)
            | TypeData::Anon {
                origin:
                    Origin::ClassStatic(symbol)
                    | Origin::Function(symbol)
                    | Origin::EnumObject(symbol)
                    | Origin::Module(symbol)
                    | Origin::Namespace { module: symbol, .. },
                ..
            } => files.is_brought(symbol.file),
            TypeData::TypeParam(file, ..)
            | TypeData::Anon {
                origin: Origin::TypeLiteral(file, _) | Origin::Mapped(file, _),
                ..
            } => files.is_brought(*file),
            TypeData::Union(parts) | TypeData::Intersection(parts) if depth < 3 => {
                (parts.iter()).any(|&part| self.is_type_brought(part, depth + 1))
            }
            _ => false,
        }
    }

    pub(in crate::check) fn is_signature_brought(&self, signature: SigId) -> bool {
        let origin = self.types().sig_origin(signature);
        (self.sig_decl(origin)).is_some_and(|(file, ..)| self.files().is_brought(file))
    }

    pub(in crate::check) fn is_expression_brought(&mut self, file: FileId, e: ExprId) -> bool {
        self.files().brings_declarations() && self.holds_brought_name(file, e, &mut SmallVec::new())
    }

    pub(in crate::check) fn lay_subject_by_what_error_stands_at(
        &mut self,
        diagnostic: &mut Reported,
    ) {
        let is_about_types = diagnostic.class == DiagnosticClass::Semantic;
        if !is_about_types
            || diagnostic.subject != DiagnosticSubject::None
            || STORE_TO_WHAT_TAKES_NO_STORE_CODES.contains(&diagnostic.code)
            || diagnostic.file == NOWHERE.0
            || !self.files().brings_declarations()
        {
            return;
        }
        let (file, start, end) = (diagnostic.file, diagnostic.start, diagnostic.end);
        let Some(e) = self.smallest_expression_around(file, start, end) else {
            return;
        };
        if self.follows_to_brought_name(file, e, &mut SmallVec::new(), false) {
            diagnostic.subject = DiagnosticSubject::BroughtDeclaration;
        }
    }

    fn smallest_expression_around(&self, file: FileId, start: u32, end: u32) -> Option<ExprId> {
        let hir = self.hir(file);
        let mut found: Option<(u32, ExprId)> = None;
        let mut pending: SmallVec<[Node; 16]> = SmallVec::from_slice(&[Node::FILE]);
        while let Some(at) = pending.pop() {
            hir.for_each_child(at, &mut |child| {
                if child.part().is_some() {
                    pending.push(child);
                    return false;
                }
                let (from, to) = (hir.start(child), self.end_of_node(file, child));
                if from <= start && end <= to {
                    if let NodeData::Expr(e) = hir.data(child)
                        && found.is_none_or(|(length, _)| to - from <= length)
                    {
                        found = Some((to - from, e));
                    }
                    pending.push(child);
                }
                false
            });
        }
        found.map(|(_, e)| e)
    }

    pub(in crate::check) fn is_class_below_brought_class(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        let files = self.files();
        let (mut file, mut e) = (file, e);
        for _ in 0..MOST_CLASSES_CLIMBED {
            if self.is_expression_brought(file, e) {
                return true;
            }
            let ExprKind::Ident(name) = self.hir(file)[e].kind else {
                return false;
            };
            let Ok(Some(symbol)) = self.resolve_identifier(file, e, name, true) else {
                return false;
            };
            let target = match files.flags(symbol).intersects(SymFlags::ALIAS) {
                true => files.resolve_alias(symbol).unwrap_or(symbol),
                false => symbol,
            };
            let declarations = files.decls_of(files.canonical(target));
            let class = declarations
                .iter()
                .find_map(|&(of, declaration)| match declaration {
                    Decl::Class(class) if self.hir(of)[class].extends.is_some() => {
                        Some((of, class))
                    }
                    _ => None,
                });
            let Some((of, class)) = class else {
                return false;
            };
            (file, e) = (of, self.hir(of)[class].extends);
        }
        false
    }

    pub(in crate::check) fn is_target_brought(&mut self, file: FileId, target: ExprId) -> bool {
        if self.is_expression_brought(file, target) {
            return true;
        }
        let ExprKind::Dot { obj, name, .. } = self.hir(file).checked_kind(target) else {
            return false;
        };
        if !self.files().brings_declarations() {
            return false;
        }
        let object = self.type_of_expr(file, obj);
        let object = self.apparent_type(object);
        matches!(self.prop_ref(object, name), Some((prop, _))
            if matches!(prop.source, PropSource::Symbol(symbol) if self.files().is_brought(symbol.file)))
    }

    fn holds_brought_name(&mut self, file: FileId, e: ExprId, seen: &mut SeenExpressions) -> bool {
        self.follows_to_brought_name(file, e, seen, true)
    }

    fn follows_to_brought_name(
        &mut self,
        file: FileId,
        e: ExprId,
        seen: &mut SeenExpressions,
        asks_types: bool,
    ) -> bool {
        let (files, hir) = (self.files(), self.hir(file));
        let mut pending: SmallVec<[Node; 16]> = SmallVec::from_slice(&[hir.node(e)]);
        while let Some(at) = pending.pop() {
            let NodeData::Expr(inner) = hir.data(at) else {
                hir.for_each_child(at, &mut |child| {
                    pending.push(child);
                    false
                });
                continue;
            };
            let ExprKind::Ident(name) = hir[inner].kind else {
                if let ExprKind::Dot { obj, name, .. } = hir[inner].kind
                    && asks_types
                    && self.is_member_made_of_brought_names(file, obj, name, seen)
                {
                    return true;
                }
                hir.for_each_child(at, &mut |child| {
                    pending.push(child);
                    false
                });
                continue;
            };
            let Ok(Some(symbol)) = self.resolve_identifier(file, inner, name, true) else {
                continue;
            };
            let target = match files.flags(symbol).intersects(SymFlags::ALIAS) {
                true => files.resolve_alias(symbol).unwrap_or(symbol),
                false => symbol,
            };
            let is_declared_there = |symbol: Sym| {
                let declarations = files.decls_of(files.canonical(symbol));
                declarations.iter().any(|&(of, declaration)| {
                    !matches!(declaration, Decl::Interface(_) | Decl::Alias(_))
                        && files.is_brought(of)
                })
            };
            if is_declared_there(symbol) || is_declared_there(target) {
                return true;
            }
            if self.is_made_of_brought_names(target, seen, asks_types) {
                return true;
            }
        }
        false
    }

    fn is_member_made_of_brought_names(
        &mut self,
        file: FileId,
        obj: ExprId,
        name: Atom,
        seen: &mut SeenExpressions,
    ) -> bool {
        let object = self.type_of_expr(file, obj);
        let object = self.apparent_type(object);
        match self.prop_ref(object, name) {
            Some((prop, _)) => match prop.source {
                PropSource::Symbol(symbol) => self.is_made_of_brought_names(symbol, seen, true),
                _ => false,
            },
            None => false,
        }
    }

    fn is_made_of_brought_names(
        &mut self,
        symbol: Sym,
        seen: &mut SeenExpressions,
        asks_types: bool,
    ) -> bool {
        let files = self.files();
        let mut made_of: SmallVec<[(FileId, ExprId); 4]> = SmallVec::new();
        for &(file, declaration) in files.decls_of(files.canonical(symbol)).iter() {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let mut returned_by = |function: FnId| {
                if hir[function].ret.is_some() {
                    return;
                }
                match hir[function].body {
                    FnBody::None => {}
                    FnBody::Expr(body) => made_of.push((file, body)),
                    FnBody::Block(_) => {
                        for s in bound.ids(bound.fns[function.idx()].returns) {
                            if let StmtKind::Return(returned) = hir[s].kind
                                && returned.is_some()
                            {
                                made_of.push((file, returned));
                            }
                        }
                    }
                }
            };
            match declaration {
                Decl::Fn(function) => returned_by(function),
                Decl::Member(member) => match hir[member].kind {
                    MemberKind::Method | MemberKind::Getter => returned_by(hir[member].func),
                    MemberKind::Property
                        if hir[member].ty.is_none() && hir[member].init.is_some() =>
                    {
                        made_of.push((file, hir[member].init));
                    }
                    _ => {}
                },
                Decl::Var(pat) => match root_declaration(bound, pat) {
                    PatParent::Var(variable) if hir[variable].ty.is_some() => {}
                    PatParent::Var(variable) if hir[variable].init.is_some() => {
                        made_of.push((file, hir[variable].init));
                    }
                    _ => return true,
                },
                Decl::Param(pat) => match root_declaration(bound, pat) {
                    PatParent::Param(parameter) if hir[parameter].ty.is_some() => {}
                    PatParent::Param(parameter) if hir[parameter].default.is_some() => {
                        made_of.push((file, hir[parameter].default));
                    }
                    _ => return true,
                },
                _ => {}
            }
        }
        for (file, e) in made_of {
            if seen.len() == MOST_EXPRESSIONS_FOLLOWED || seen.contains(&(file, e)) {
                continue;
            }
            seen.push((file, e));
            if self.follows_to_brought_name(file, e, seen, asks_types) {
                return true;
            }
        }
        false
    }

    pub(in crate::check) fn member_container(&self, symbol: Sym) -> DiagnosticSubject {
        let container = self.files().canonical(symbol);
        self.files().keep_tree(container.file);
        DiagnosticSubject::MemberContainer(container)
    }

    pub(in crate::check) fn member_container_of_type(&self, ty: TypeId) -> DiagnosticSubject {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => self.member_container(target),
            TypeData::Anon {
                origin:
                    Origin::Module(module) | Origin::Namespace { module, .. } | Origin::Function(module),
                ..
            } => self.member_container(module),
            _ => DiagnosticSubject::None,
        }
    }
}
