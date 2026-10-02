//! The symbol at every name of a file: what TypeScript's test harness writes into `.symbols` baselines
//! (`typeWriterWalker.getSymbols`, `GetSymbolAtLocation`, `SymbolToStringEx`).
//!
//! Members of classes, interfaces, type literals and object literals have no `SymbolId`: such a symbol is a [`Prop`], and its
//! declarations are those the binder and `lateBindMember` have put together with the first of them.

use super::enclosing_declaration::Enclosing;
use super::errors_misc::QueriedThisContainer;
use super::visit_node::{VisitedKind, VisitedNode};
use super::*;
use crate::bind::{
    ClassOwner, Decl, FnOwner, MemberDeclaration, MemberOwner, Parent, PatParent, ScopeId,
    ScopeKind,
};
use crate::util::FxHashSet;

/// `typeWriterResult`
pub struct SymbolAtLocation {
    pub start: u32,
    pub end: u32,
    /// `Symbol(C.m, Decl(a.ts, 3, 11))`
    pub symbol_text: String,
}

/// An entry of `symbol.Declarations`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Declaration {
    Bound(Decl),
    Member(MemberId),
    /// A parameter property.
    Parameter(ParamId),
    /// A property of an object literal, or a JSX attribute.
    Property(PropId),
    /// An assignment declaration, or an object literal.
    Expression(ExprId),
    /// A type literal or a mapped type.
    TypeNode(TypeNodeId),
    ThisParameter(FnId),
}

/// What `getSymbolAtLocation` returns.
#[derive(Clone)]
enum Found {
    Symbol(Sym),
    Property(Prop),
    /// `createUnionOrIntersectionProperty`: the properties in `propSet`.
    Properties(Vec<Prop>),
    /// A symbol with one declaration that is in no table: `__object`, `__type`, a `this` parameter.
    Anonymous {
        name: String,
        file: FileId,
        declaration: Declaration,
    },
    /// A symbol without declarations: `undefined`, `arguments`, `globalThis`, `getUnresolvedSymbolForEntityName`.
    Undeclared(String),
    /// The `prototype` of a class: no declarations, and the class for a parent.
    Prototype(Sym),
    /// The `default` that `createDefaultPropertyWrapperForModule` makes: no declarations, and the module for a parent.
    SyntheticDefault(Sym),
    /// `getApplicableIndexSymbol`: `__index`, declared by the index signature that applies. The parent is `t.symbol`.
    IndexSignature {
        parent: Option<Sym>,
        declarations: Vec<(FileId, MemberId)>,
    },
}

/// `symbol.Parent`, of a property.
enum PropertyParent {
    Symbol(Sym),
    /// A function expression that has no `SymbolId`, by the name `getNameOfSymbolAsWritten` gives it.
    Named(String),
}

impl Checker<'_> {
    /// `typeWriterWalker.getSymbols`, in no particular order. The file must have been checked, as in the harness.
    pub fn symbols_at_locations(&mut self, file: FileId) -> Vec<SymbolAtLocation> {
        let mut nodes = self.visited_nodes(file);
        // A range is written once: a name comes before the expression that is kept at the same place.
        nodes.sort_by_key(|node| matches!(node.kind, VisitedKind::Expression(_)));
        let mut writer = SymbolWriter::new(self, file);
        for node in nodes {
            writer.write_symbol_of_visited_node(node);
        }
        writer.results
    }
}

struct SymbolWriter<'c, 'p> {
    c: &'c mut Checker<'p>,
    file: FileId,
    results: Vec<SymbolAtLocation>,
    written: FxHashSet<(u32, u32)>,
    /// `ECMALineMap`, by file.
    line_starts: FxHashMap<FileId, Vec<u32>>,
}

impl<'c, 'p> SymbolWriter<'c, 'p> {
    fn new(c: &'c mut Checker<'p>, file: FileId) -> SymbolWriter<'c, 'p> {
        let capacity = c.hir(file).exprs.len();
        SymbolWriter {
            c,
            file,
            results: Vec::with_capacity(capacity),
            written: FxHashSet::default(),
            line_starts: FxHashMap::default(),
        }
    }

    // ───────────────────────────── the walk ─────────────────────────────

    /// `writeTypeOrSymbol`, in the walk for symbols.
    fn write_symbol_of_visited_node(&mut self, node: VisitedNode) {
        if let Some(found) = self.get_symbol_at_visited_node(node.kind)
            && (node.start == node.end || self.written.insert((node.start, node.end)))
        {
            let scope = self.c.enclosing_scope_of_visited_node(self.file, node.kind);
            self.write_node(node.start, node.end, scope, found);
        }
    }

    fn write_node(&mut self, start: u32, end: u32, scope: ScopeId, found: Found) {
        let hir = self.c.hir(self.file);
        // `NodeFlagsInWithStatement`, `NodeFlagsReparsed`
        if hir.is_in_with(start) || hir.is_in_jsdoc(start) {
            return;
        }
        // The scope of the file stands in for a scope the binder did not record.
        let scope = if scope.is_some() { scope } else { ScopeId(0) };
        let (name, declarations) = match &found {
            Found::Symbol(symbol) => self.describe_symbol(*symbol, scope),
            Found::Property(prop) => self.describe_property(prop, scope),
            Found::Properties(props) => self.describe_properties(props, scope),
            Found::Anonymous {
                name,
                file,
                declaration,
            } => (name.clone(), vec![(*file, *declaration)]),
            Found::Undeclared(name) => (name.clone(), Vec::new()),
            Found::Prototype(class) => (
                self.qualified_by_parent(
                    Some(PropertyParent::Symbol(*class)),
                    "prototype".to_owned(),
                    scope,
                ),
                Vec::new(),
            ),
            Found::SyntheticDefault(module) => {
                let (starts_with_global_this, mut chain) =
                    self.c.lookup_symbol_chain_for_symbol_to_string(
                        *module,
                        true,
                        Enclosing::at_scope(self.file, scope),
                    );
                // `hasNonGlobalAugmentationExternalModuleSymbol`: a JSON file is no external module, so it is written. It has an
                // `export =`, which is what an import of it stands for, so no alias names the file.
                let is_json = self.c.hir(module.file).kind == FileKind::Json;
                if is_json {
                    chain = vec![*module];
                }
                // `getSymbolChain`: "symbol is a module export=, so it kinda looks like it's own parent".
                let is_its_own_parent = is_json
                    || self
                        .c
                        .files()
                        .export(*module, known::export_equals)
                        .is_some();
                let mut name = "default".to_owned();
                if !chain.is_empty() {
                    name = self.symbol_chain_to_string(starts_with_global_this, &chain, scope);
                    if !is_its_own_parent {
                        push_access(&mut name, "default", false);
                    }
                }
                (name, Vec::new())
            }
            Found::IndexSignature {
                parent,
                declarations,
            } => (
                self.qualified_by_parent(
                    parent.map(PropertyParent::Symbol),
                    "__index".to_owned(),
                    scope,
                ),
                declarations
                    .iter()
                    .map(|&(file, member)| (file, Declaration::Member(member)))
                    .collect(),
            ),
        };
        let mut symbol_text = String::with_capacity(64);
        symbol_text.push_str("Symbol(");
        symbol_text.push_str(&name);
        for (count, &(file, declaration)) in declarations.iter().enumerate() {
            if count >= 5 {
                symbol_text.push_str(&format!(" ... and {} more", declarations.len() - count));
                break;
            }
            symbol_text.push_str(", ");
            self.push_declaration(&mut symbol_text, file, declaration);
        }
        symbol_text.push(')');
        self.results.push(SymbolAtLocation {
            start,
            end,
            symbol_text,
        });
    }

    /// `getSymbolAtLocation`
    fn get_symbol_at_visited_node(&mut self, kind: VisitedKind) -> Option<Found> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        match kind {
            VisitedKind::DeclarationName(decl, id)
            | VisitedKind::SpecifierPropertyName(decl, id) => {
                if id.is_none() {
                    return None;
                }
                let symbol = files.sym(file, id);
                if bound.refused_declarations.contains(&(id, decl)) {
                    return None;
                }
                if matches!(kind, VisitedKind::DeclarationName(..)) {
                    return Some(Found::Symbol(symbol));
                }
                // `getImmediateAliasedSymbol`: the `a` of `import { a as b }` and of `export { a as b }`.
                // `getTargetOfModuleDefault`: a default that is made up is `resolveExternalModuleSymbol(moduleSymbol, dontResolveAlias)`,
                // which stops at the `export =` of the module.
                if let Some((specifier, mode, known::default)) =
                    files.external_module_member_of(file, decl)
                    && let Some(module) = files.module_of_specifier_as(file, specifier, mode)
                    && let Some(equals) = files.export(module, known::export_equals)
                    && files.alias_target(symbol) == Some(files.module_value(module))
                {
                    return Some(Found::Symbol(equals));
                }
                match files.alias_target(symbol) {
                    Some(target) => Some(Found::Symbol(files.canonical(target))),
                    // `getExternalModuleMember`: a property of the value a module says it is with `export =`.
                    None => self
                        .c
                        .property_of_alias(symbol)
                        .map(|prop| Found::Property(prop.clone())),
                }
            }
            // `IsLiteralComputedPropertyDeclarationName`: the literal in `["name"]`, `` [`name`] `` and `[0]` has the symbol of the
            // declaration.
            VisitedKind::LiteralInEnumMemberName(m) => Some(Found::Symbol(
                files.sym(file, bound.enum_member_symbol[m.idx()]),
            )),
            // `declareSymbolEx`: a name that names nothing, `#x` with no class around it or `1n`, gives a symbol all the same
            // (`InternalSymbolNameMissing`), which is in no table.
            VisitedKind::MemberName(m) | VisitedKind::LiteralInMemberName(m) => {
                let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
                (!matches!(hir[m].key, PropKey::None) || is_written_name(hir, start))
                    .then(|| self.property_of_member(m))
            }
            VisitedKind::PropertyName(p) | VisitedKind::LiteralInPropertyName(p) => {
                let name = hir[p].key.name().unwrap_or(Atom::NONE);
                (!matches!(hir[p].key, PropKey::None) || is_written_name(hir, hir[p].pos)).then(
                    || {
                        Found::Property(Prop {
                            name,
                            flags: PropFlags::empty(),
                            source: PropSource::Literal(file, p),
                            mapper: MapperId::IDENTITY,
                        })
                    },
                )
            }
            VisitedKind::BindingName(pat) => {
                let PatKind::Ident(name) = hir[pat].kind else {
                    return None;
                };
                // `bindParameter` declares the property last, so that is the symbol of the node. `IsParameterPropertyDeclaration`
                if let PatParent::Param(parameter) = bound.pat_parent[pat.idx()]
                    && hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
                    && hir[bound.param_fn[parameter.idx()]].kind == FnKind::Constructor
                {
                    return Some(Found::Property(Prop {
                        name,
                        flags: PropFlags::empty(),
                        source: PropSource::Parameter(file, parameter),
                        mapper: MapperId::IDENTITY,
                    }));
                }
                let symbol = bound.pat_symbol[pat.idx()];
                symbol
                    .is_some()
                    .then(|| Found::Symbol(files.sym(file, symbol)))
            }
            // `{ ["name"]: local }`: the binding element is the declaration.
            VisitedKind::LiteralInBindingPropertyName(p) => {
                let value = hir[p].value;
                if value.is_none() || !matches!(hir[value].kind, PatKind::Ident(_)) {
                    return None;
                }
                let symbol = bound.pat_symbol[value.idx()];
                symbol
                    .is_some()
                    .then(|| Found::Symbol(files.sym(file, symbol)))
            }
            // `{ name: local }`: the property of the type of the pattern.
            VisitedKind::BindingPropertyName(p) => {
                let parent = bound.pat_parent[hir[p].value.idx()];
                let (PropKey::Name(name), PatParent::Prop(pattern, _)) = (hir[p].key, parent)
                else {
                    return None;
                };
                // `getTypeOfNode` of a binding pattern is `getTypeForVariableLikeDeclaration` of its parent: of a parameter,
                // `getContextuallyTypedParameterType`. "If inference didn't come up with anything but unknown, fall back to the
                // binding pattern" (`assignParameterType`) only reaches the type of the symbol.
                if let PatParent::Param(param) = bound.pat_parent[pattern.idx()]
                    && hir[param].ty.is_none()
                {
                    let func = bound.param_fn[param.idx()];
                    let index = (param.0 - hir[func].params.start) as usize;
                    if self.c.contextual_param_type(file, func, index) == Some(TypeId::UNKNOWN) {
                        return None;
                    }
                }
                let ty = self.c.type_of_pat(file, pattern);
                self.get_property_of_type(ty, name)
            }
            VisitedKind::ThisParameter(f) => self.this_parameter(file, f),
            VisitedKind::Expression(e) | VisitedKind::AccessName(e) => {
                let is_name = matches!(kind, VisitedKind::AccessName(_));
                self.get_symbol_of_expression(e, is_name)
            }
            // A type reference that resolves to nothing.
            VisitedKind::ConstOfAsConst(_) => Some(Found::Undeclared("const".to_owned())),
            // `getIntrinsicTagSymbol`
            VisitedKind::JsxIntrinsicTagName(_, tag) => {
                let (ExprKind::String(name) | ExprKind::Ident(name)) = hir[tag].kind else {
                    return None;
                };
                let elements = self.c.jsx_type(file, known::IntrinsicElements)?;
                match self.c.prop_of(elements, name) {
                    Some((prop, _)) => Some(Found::Property(prop)),
                    None => match self.get_applicable_index_symbol(elements, name) {
                        Some(found) => Some(found),
                        // An index signature nothing declares, as `Record<string, any>` gives: `intrinsicElementsType.symbol`.
                        None => {
                            let members = self.c.members(elements)?;
                            self.c
                                .applicable_index(&members, TypeId::STRING, Some(name))?;
                            self.symbol_of_type(elements)
                        }
                    },
                }
            }
            VisitedKind::TypeReferenceName(node, index)
            | VisitedKind::HeritageClauseName(node, index)
            | VisitedKind::HeritageClausePropertyAccess(node, index) => {
                let scope = bound.type_scope[node.idx()];
                let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                    return None;
                };
                if scope.is_none() {
                    return None;
                }
                let names: Vec<Atom> = hir.ids(name).take(index as usize + 1).collect();
                let meaning = if names.len() == name.len() {
                    SymFlags::TYPE
                } else {
                    SymFlags::NAMESPACE
                };
                match self.c.resolve_entity(file, scope, &names, meaning) {
                    Some(symbol) => Some(Found::Symbol(symbol)),
                    None if !matches!(kind, VisitedKind::TypeReferenceName(..)) => None,
                    // `getUnresolvedSymbolForEntityName`, which is `unknownSymbol` for a name the parser missed.
                    None if names.last() == Some(&known::empty) => {
                        Some(Found::Undeclared("unknown".to_owned()))
                    }
                    None => {
                        let path: Vec<_> = names
                            .iter()
                            .map(|&part| match part {
                                known::empty => "unknown".into(),
                                _ => files.atoms.text(part),
                            })
                            .collect();
                        Some(Found::Undeclared(path.join(".")))
                    }
                }
            }
            // `getTypeFromImportTypeNode`: the identifiers of the qualifier.
            VisitedKind::ImportTypeQualifierName(node, index) => {
                let TypeNodeKind::Import {
                    spec,
                    name,
                    is_typeof,
                    mode,
                    ..
                } = hir[node].kind
                else {
                    return None;
                };
                if bound.type_scope[node.idx()].is_none() {
                    return None;
                }
                let module =
                    files.module_of_specifier_as(file, spec, files.mode_of_import(file, mode))?;
                let mut found = files.module_value(module);
                // `getTypeFromImportTypeNode`, `isTypeOf`: each name is a property of the type of what is before it.
                if is_typeof {
                    let mut ty = self.c.type_of_symbol(found);
                    let mut last = None;
                    for part in hir.ids(name).take(index as usize + 1) {
                        last = self.get_property_of_type(ty, part);
                        ty = self.c.type_of_property(ty, part)?;
                    }
                    return last;
                }
                for (at, part) in hir.ids(name).enumerate().take(index as usize + 1) {
                    let meaning = if at + 1 < name.len() {
                        SymFlags::NAMESPACE
                    } else {
                        SymFlags::TYPE
                    };
                    let container = files.resolve_alias_if_needed(found)?;
                    found = files.namespace_member(container, part)?;
                    if !files.means(found, meaning) {
                        return None;
                    }
                }
                Some(Found::Symbol(found))
            }
            VisitedKind::TypePredicateParameter(node) => {
                let TypeNodeKind::Predicate { param, .. } = hir[node].kind else {
                    return None;
                };
                let scope = bound.type_scope[node.idx()];
                if scope.is_none() {
                    return None;
                }
                files
                    .resolve_name(file, scope, param, SymFlags::FUNCTION_SCOPED_VARIABLE)
                    .map(Found::Symbol)
            }
            // `getSymbolOfPartOfRightHandSideOfImportEquals`
            VisitedKind::ImportEqualsName(import, index) => {
                let ImportEqualsTarget::Entity(list) = hir[import].target else {
                    return None;
                };
                let names: Vec<Atom> = hir.ids(list).take(index as usize + 1).collect();
                let meaning = if index > 0 && names.len() == list.len() {
                    SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
                } else {
                    SymFlags::NAMESPACE
                };
                let scope = bound.import_equals_scope[import.idx()];
                files
                    .resolve_entity(file, scope, &names, meaning)
                    .map(Found::Symbol)
            }
            VisitedKind::Parenthesized(..)
            | VisitedKind::ModuleSpecifier(_)
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::JsxNamespacedNamePart
            | VisitedKind::ImportAttributeName(_)
            | VisitedKind::LiteralType(_)
            | VisitedKind::LiteralTypeOperand(_)
            | VisitedKind::Directive(_)
            | VisitedKind::Label(_) => None,
        }
    }

    /// `getSymbolAtLocation`, of the expression `e`, or of the name it ends with.
    fn get_symbol_of_expression(&mut self, e: ExprId, is_name: bool) -> Option<Found> {
        let file = self.file;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if let Some(found) = self.get_symbol_of_name_in_class_extends(e) {
            return Some(found);
        }
        match hir[e].kind {
            // Not bound.
            _ if matches!(bound.expr_parent[e.idx()], Parent::None) => None,
            ExprKind::Ident(name) => self.get_symbol_of_identifier(e, name),
            // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the symbol of the whole access.
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                if self.is_commonjs_module_exports(e, obj) {
                    return Some(Found::Anonymous {
                        name: "exports".to_owned(),
                        file,
                        declaration: Declaration::Bound(Decl::File),
                    });
                }
                let ty = self
                    .c
                    .left_type_of_property_access(file, obj, chain)
                    .0
                    .ok()?;
                let ty = self.c.widened_left_type_of_property_access(file, e, ty);
                if self.c.is_apparently_unknown(ty) {
                    return None;
                }
                // `skipObjectFunctionPropertyAugment`: a `const enum` has no `toString`.
                if self.c.is_const_enum_object(ty)
                    && self
                        .c
                        .members(ty)
                        .is_none_or(|members| members.shape().prop(name).is_none())
                {
                    return None;
                }
                // `checkQualifiedName`: `includeTypeOnlyMembers`, so `export type { A }` counts in `typeof ns.A`.
                let queried_module = match *self.c.data(ty) {
                    TypeData::Anon {
                        origin: Origin::Module(module) | Origin::Namespace { module, .. },
                        ..
                    } if bound.is_in_type_query(e) => Some(module),
                    _ => None,
                };
                match self.get_property_of_type(ty, name) {
                    Some(found) => Some(found),
                    None if self.c.is_private_name(name) => None,
                    None if queried_module.is_some() => queried_module
                        .and_then(|module| self.c.files().namespace_member(module, name))
                        .map(Found::Symbol),
                    // `checkExpressionCached(name.Expression())`: the type as it is, with its `undefined`.
                    None => {
                        let ty = self.c.type_of_expr(file, obj);
                        self.get_applicable_index_symbol(ty, name)
                    }
                }
            }
            ExprKind::String(_) | ExprKind::Number(_) | ExprKind::Template { .. } => {
                self.get_symbol_of_literal(e)
            }
            ExprKind::This => {
                let is_queried = bound.is_in_type_query(e);
                // `GetThisContainer`
                let function = if is_queried {
                    match self.c.this_container_of_type_query(file, e) {
                        Some(QueriedThisContainer::Fn(function)) => Some(function),
                        _ => None,
                    }
                } else {
                    match self.c.this_container(file, e) {
                        Some(Ok(function)) => Some(function),
                        _ => None,
                    }
                };
                if let Some(found) =
                    function.and_then(|function| self.this_parameter_of_function(function))
                {
                    return Some(found);
                }
                // `IsInExpressionContext`: not the `this` of a bare `typeof this`, whose parent is the type query, so it is
                // `getThisType(node).symbol`, which no narrowing changes. That of `typeof this.x` is under a qualified name, which
                // is an expression node.
                if is_queried
                    && !matches!(bound.expr_parent[e.idx()], Parent::Expr(_))
                    && let Some(function) = function
                {
                    return match bound.fns[function.idx()].owner {
                        FnOwner::Member(m) if !hir[m].flags.contains(Flags::STATIC) => {
                            self.container_of_member(file, m).map(Found::Symbol)
                        }
                        _ => None,
                    };
                }
                let ty = self.c.type_of_expr(file, e);
                self.symbol_of_type(ty)
            }
            // The `meta` of `import.meta` is the member of `getGlobalImportMetaExpressionType`.
            ExprKind::ImportMeta if is_name => {
                Some(Found::Undeclared("ImportMetaExpression.meta".to_owned()))
            }
            // `getSymbolAtLocation`, `KindMetaProperty`: the name has a symbol only if it is the right one.
            ExprKind::NewTarget(name)
                if is_name && self.c.files().atoms.bytes(name) != b"target" =>
            {
                None
            }
            // `checkExpression(node).symbol`. The `target` of `new.target` has the same symbol.
            ExprKind::Super | ExprKind::ImportMeta | ExprKind::NewTarget(_) => {
                let ty = self.c.type_of_expr(file, e);
                self.symbol_of_type(ty)
            }
            _ => None,
        }
    }

    /// `isInNameOfExpressionWithTypeArguments`, in what a class extends: `e` is an entity name expression that is all of it, and
    /// is looked for as a value, or what is before a dot in it, and is looked for as a namespace. An alias counts whatever it
    /// stands for.
    fn get_symbol_of_name_in_class_extends(&self, e: ExprId) -> Option<Found> {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let mut whole = e;
        loop {
            match bound.expr_parent[whole.idx()] {
                Parent::ClassExtends(_) => break,
                Parent::Expr(access)
                    if access.is_some()
                        && !is_parenthesized(hir, whole)
                        && matches!(hir[access].kind, ExprKind::Dot { obj, .. } if obj == whole) =>
                {
                    whole = access;
                }
                _ => return None,
            }
        }
        // `IsEntityNameExpression`
        let (mut names, mut at) = (Vec::new(), e);
        loop {
            match hir[at].kind {
                ExprKind::Ident(name) => names.push(name),
                ExprKind::Dot { obj, name, .. } if !is_parenthesized(hir, obj) => {
                    names.push(name);
                    at = obj;
                    continue;
                }
                _ => return None,
            }
            break;
        }
        names.reverse();
        let meaning = if whole == e {
            SymFlags::VALUE
        } else {
            SymFlags::NAMESPACE
        };
        let &scope = bound.expr_scope.get(&whole)?;
        let symbol =
            self.c
                .files()
                .resolve_entity(self.file, scope, &names, meaning | SymFlags::ALIAS)?;
        Some(Found::Symbol(symbol))
    }

    /// `getSymbolAtLocation`, of a string, a number or a template without substitutions.
    fn get_symbol_of_literal(&mut self, e: ExprId) -> Option<Found> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        // `getSymbolForPrivateIdentifierExpression`: the `#x` of `#x in a`.
        if let (ExprKind::String(name), Some(&class)) = (hir[e].kind, bound.private_class.get(&e)) {
            // `lookupSymbolForPrivateIdentifierDeclaration`: the members of the class before its statics.
            let declaration = |is_static: bool| {
                hir[class].members.iter().find(|&member| {
                    hir[member].key == PropKey::Private(name)
                        && hir[member].flags.contains(Flags::STATIC) == is_static
                })
            };
            let member = declaration(false).or_else(|| declaration(true))?;
            return Some(self.property_of_member(member));
        }
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if parent.is_none() {
            return None;
        }
        let specifier = |mode: ResolutionMode| match hir[e].kind {
            ExprKind::String(text) => files
                .module_of_specifier_as(file, text, mode)
                .map(Found::Symbol),
            _ => None,
        };
        let name = match hir[e].kind {
            ExprKind::String(text) => text,
            ExprKind::Number(number) => self.c.number_name(hir.numbers[number as usize]),
            ExprKind::Template { exprs, texts } if exprs.is_empty() => hir.ids(texts).next()?,
            _ => return None,
        };
        match hir[parent].kind {
            // `a["name"]`, `a[0]`
            ExprKind::Index { obj, index, .. } if index == e && !is_parenthesized(hir, e) => {
                let ty = self.c.type_of_expr(file, obj);
                self.get_property_of_type(ty, name)
            }
            // `resolveExternalModuleName`
            ExprKind::ImportCall { args, .. } if hir.id_at(args, 0) == e => {
                specifier(files.mode_of_import_call(file))
            }
            // `IsVariableDeclarationInitializedToRequire`
            ExprKind::Call(_)
                if matches!(bound.expr_parent[parent.idx()], Parent::VarInit(d)
                    if bound.required_by(hir, hir[d].pat).is_some()
                        && !hir[d].flags.contains(Flags::EXPORT))
                    && crate::bind::require_argument(hir, parent) == Some(e) =>
            {
                specifier(ResolutionMode::Require)
            }
            // `getSymbolOfDeclaration(parent)`: the key of `Object.defineProperty(object, "name", descriptor)`, which declares
            // the property in JavaScript.
            ExprKind::Call(_) if hir.is_js && !matches!(hir[e].kind, ExprKind::Number(_)) => {
                let (object, key) = crate::bind::define_property_call(hir, parent)?;
                // Nil where the binder took the call for no declaration: `Object.defineProperty(module, "exports", ..)`.
                let is_declaration = bound.is_expando_declaration(parent)
                    || crate::bind::assignment_declaration_kind(hir, parent)
                        == crate::bind::JsDeclarationKind::ObjectDefinePropertyExports;
                if key != e || !is_declaration {
                    return None;
                }
                let ty = self.c.type_of_expr(file, object);
                self.get_property_of_type(ty, name)
            }
            _ => None,
        }
    }

    /// `member.Symbol`, of a member of the file that is written.
    fn property_of_member(&mut self, member: MemberId) -> Found {
        let file = self.file;
        let name = self
            .c
            .declared_member_name(file, self.c.hir(file)[member].key);
        Found::Property(Prop {
            name: name.unwrap_or(Atom::NONE),
            flags: PropFlags::empty(),
            source: PropSource::Members(vec![(file, member)].into()),
            mapper: MapperId::IDENTITY,
        })
    }

    /// `getSignatureFromDeclaration(function).thisParameter`
    fn this_parameter_of_function(&mut self, function: FnId) -> Option<Found> {
        let file = self.file;
        if let Some(found) = self.this_parameter(file, function) {
            return Some(found);
        }
        // "If only one accessor includes a this-type annotation, the other behaves as if it had the same type annotation"
        let other = match self.c.hir(file)[function].kind {
            FnKind::Getter => self.c.sibling_accessor(file, function, FnKind::Setter),
            FnKind::Setter => self.c.sibling_accessor(file, function, FnKind::Getter),
            _ => None,
        };
        if let Some(found) = other.and_then(|other| self.this_parameter(file, other)) {
            return Some(found);
        }
        // `assignContextualParameterTypes`: a copy of that of the contextual signature, with its declarations.
        let FnOwner::Expr(owner) = self.c.bound(file).fns[function.idx()].owner else {
            return None;
        };
        if !self
            .c
            .is_context_sensitive_function_or_method(file, function, owner)
        {
            return None;
        }
        let context = self.c.contextual_signature(file, function)?;
        let (file, function, _) = self.c.sig_decl(context)?;
        self.this_parameter(file, function)
    }

    /// The symbol of the `this` parameter that `function` declares.
    fn this_parameter(&self, file: FileId, function: FnId) -> Option<Found> {
        let hir = self.c.hir(file);
        let this = hir.params.get(hir[function].this_param.idx())?;
        // `DeclarationNameToString`
        let name = match hir[this.pat].kind {
            PatKind::Ident(name) => self.c.files().atoms.text(name).to_string(),
            _ => "(Missing)".to_owned(),
        };
        Some(Found::Anonymous {
            name,
            file,
            declaration: Declaration::ThisParameter(function),
        })
    }

    /// `module.exports`, where `module` is the variable of a CommonJS module.
    fn is_commonjs_module_exports(&self, e: ExprId, module: ExprId) -> bool {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let symbol = bound.expr_symbol[module.idx()];
        crate::bind::is_module_exports(hir, e)
            && symbol.is_some()
            && bound.symbols[symbol.idx()]
                .flags
                .contains(SymFlags::MODULE_EXPORTS)
    }

    // ───────────────────────────── `getSymbolAtLocation` ─────────────────────────────

    /// `resolveEntityName(name, SymbolFlagsValue, ..)`, of the identifier `e` for which `checkIdentifier` has `exported`. That asks
    /// for `ExportValue` too, and goes on from the local symbol it finds to `ExportSymbol`. Without it a local symbol that is no
    /// value is passed over, for what the table of exports has.
    fn resolve_without_export_value(&self, e: ExprId, name: Atom, exported: Sym) -> Option<Sym> {
        let (file, files, bound) = (self.file, self.c.files(), self.c.bound(self.file));
        let mut scope = self.c.enclosing_scope_of_expr(file, e);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if matches!(s.kind, ScopeKind::File | ScopeKind::Module(_))
                && let Some(local) = bound.lookup(s.locals, name)
            {
                let leads_there = bound.symbols[local.idx()].export_symbol.is_some()
                    && files.export_symbol_of_value_symbol_if_exported(files.sym(file, local))
                        == exported;
                return if leads_there {
                    files.resolve_name(file, scope, name, SymFlags::VALUE)
                } else {
                    Some(exported)
                };
            }
            scope = s.parent;
        }
        Some(exported)
    }

    /// `getSymbolOfNameOrPropertyAccessExpression`, of an identifier that is an expression.
    fn get_symbol_of_identifier(&self, e: ExprId, name: Atom) -> Option<Found> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        // The `a` of `export * from a` is neither an expression node nor a name in a type.
        if hir.specifier_expressions.contains(&e) {
            return None;
        }
        // `export default a`, `export = a`: every meaning counts.
        if let Parent::Stmt(statement) = bound.expr_parent[e.idx()]
            && statement.is_some()
            && matches!(
                hir[statement].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            )
            && !is_parenthesized(self.c.hir(file), e)
            && let Some(&scope) = bound.expr_scope.get(&e)
            && let Some(symbol) = files.resolve_name(
                file,
                scope,
                name,
                SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS,
            )
        {
            return Some(Found::Symbol(symbol));
        }
        // `ignoreErrors`
        match self
            .c
            .resolve_identifier(file, e, name, true)
            .unwrap_or(None)
        {
            // `getSymbol`: an alias that stands for no value is not there.
            Some(symbol) if !files.means(symbol, SymFlags::VALUE) => None,
            Some(symbol) => self
                .resolve_without_export_value(e, name, symbol)
                .map(Found::Symbol),
            None => match name {
                known::arguments if bound.is_arguments_object(e) => {
                    Some(Found::Undeclared(self.c.atom_text(name)))
                }
                // `RequireSymbol`
                known::require
                    if hir.is_js
                        && matches!(bound.expr_parent[e.idx()], Parent::Expr(call) if call.is_some() && crate::bind::require_argument(hir, call).is_some()) =>
                {
                    Some(Found::Undeclared(self.c.atom_text(name)))
                }
                _ => None,
            },
        }
    }

    /// `getPropertyOfType`
    fn get_property_of_type(&mut self, ty: TypeId, name: Atom) -> Option<Found> {
        // `getReducedApparentType`
        let ty = self.c.apparent_type(ty);
        let ty = self.c.reduced(ty);
        if !matches!(self.c.data(ty), TypeData::Union(_)) {
            let members = self.c.members(ty)?;
            // `typeOnlyExportStarMap`: what a module has through `export type *` is listed and is not there for the asking.
            if members.shape().prop(name).is_some() && self.c.prop_ref(ty, name).is_none() {
                return None;
            }
            let (prop, _) = self.c.property_of_type(&members, name)?;
            // `bindClassLikeDeclaration`
            if name == known::prototype
                && matches!(prop.source, PropSource::Type(_))
                && let TypeData::Anon {
                    origin: Origin::ClassStatic(class),
                    ..
                } = *self.c.data(ty)
            {
                return Some(Found::Prototype(class));
            }
            if name == known::default && matches!(prop.source, PropSource::Type(_)) {
                let module = match self.c.data(ty) {
                    TypeData::Synth(shape) => shape.default_of,
                    TypeData::Anon {
                        origin:
                            Origin::Namespace {
                                originating_import, ..
                            },
                        ..
                    } => {
                        // `resolveESModuleSymbol`: `moduleSymbol`, not what it says it is with `export =`.
                        let (files, at) = (self.c.files(), originating_import.file);
                        let declarations = &files.symbol(*originating_import).decls;
                        declarations.iter().find_map(|decl| match *decl {
                            Decl::ImportNamespace(import) => {
                                let import = &self.c.hir(at)[import];
                                let mode = files.mode_of_import(at, import.mode);
                                files.module_of_specifier_as(at, import.spec, mode)
                            }
                            _ => None,
                        })
                    }
                    _ => None,
                };
                if let Some(module) = module {
                    return Some(Found::SyntheticDefault(module));
                }
            }
            return Some(Found::Property(prop));
        }
        // `createUnionOrIntersectionProperty`
        let parts = self.c.parts(ty);
        if self.c.is_hidden_in_union(parts, name) {
            return None;
        }
        let mut prop_set: Vec<(Prop, MapperId)> = Vec::new();
        for &part in self.c.parts(ty) {
            let part = self.c.apparent_type(part);
            if part.is_never() {
                continue;
            }
            let members = self.c.members(part)?;
            let Some((prop, mapper)) = self.c.property_of_type(&members, name) else {
                // `CheckFlagsWritePartial`: an index signature applies, or the constituent is an object literal type without a
                // spread. Otherwise `CheckFlagsReadPartial`, and `getPropertyOfType` has no such property.
                let is_write_partial = self
                    .c
                    .applicable_index_info(&members, TypeId::STRING, Some(name))
                    .is_some()
                    || self.c.is_closed_object_literal_type(part)
                    || matches!(
                        self.c.data(part),
                        TypeData::Anon {
                            origin: Origin::WidenedLiteral(..),
                            ..
                        }
                    );
                if is_write_partial {
                    continue;
                }
                return None;
            };
            let is_same_symbol = |other: &(Prop, MapperId)| {
                other.0.source == prop.source && other.0.mapper == prop.mapper && other.1 == mapper
            };
            if prop_set.iter().any(is_same_symbol) {
                continue;
            }
            // `isInstantiation`: instantiations of one property that have the same type are one property.
            if let Some(single) = prop_set.first().cloned()
                && single.0.source == prop.source
                && self.c.type_of_prop(&single.0, single.1) == self.c.type_of_prop(&prop, mapper)
            {
                continue;
            }
            prop_set.push((prop, mapper));
        }
        let mut props: Vec<Prop> = prop_set.into_iter().map(|entry| entry.0).collect();
        match props.len() {
            0 => None,
            1 => props.pop().map(Found::Property),
            _ => Some(Found::Properties(props)),
        }
    }

    /// `getApplicableIndexSymbol`, for the key `name`.
    fn get_applicable_index_symbol(&mut self, ty: TypeId, name: Atom) -> Option<Found> {
        // `getIndexInfosOfType`: `getReducedApparentType`. What `getUnionIndexInfos` makes has no declaration.
        let apparent = self.c.apparent_type(ty);
        let apparent = self.c.reduced(apparent);
        if self.c.is_union(apparent) {
            return None;
        }
        let members = self.c.members(apparent)?;
        let info = self
            .c
            .applicable_index(&members, TypeId::STRING, Some(name))?;
        let mut declarations = Vec::new();
        match info.declaration {
            Some(declaration) => declarations.push(declaration),
            None => {
                for info in &members.shape().index {
                    if let Some(declaration) = info.declaration
                        && self.c.is_name_applicable_to_index(name, info.key)
                    {
                        declarations.push(declaration);
                    }
                }
            }
        }
        if declarations.is_empty() {
            return None;
        }
        // `t.symbol`
        let parent = match *self.c.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) => Some(target),
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => Some(class),
            TypeData::TypeParam(file, parameter, _) => {
                let symbol = self.c.bound(file).type_param_symbol[parameter.idx()];
                symbol.is_some().then(|| self.c.files().sym(file, symbol))
            }
            _ => None,
        };
        Some(Found::IndexSignature {
            parent,
            declarations,
        })
    }

    /// `t.symbol`
    fn symbol_of_type(&mut self, ty: TypeId) -> Option<Found> {
        let files = self.c.files();
        Some(match *self.c.data(ty) {
            TypeData::ThisParam(symbol) | TypeData::Enum { symbol, .. } => Found::Symbol(symbol),
            TypeData::Ref { target, .. } => Found::Symbol(target),
            TypeData::EnumLit { member, .. } => Found::Symbol(member),
            TypeData::TypeParam(file, parameter, _) => {
                let symbol = self.c.bound(file).type_param_symbol[parameter.idx()];
                if symbol.is_none() {
                    return None;
                }
                Found::Symbol(files.sym(file, symbol))
            }
            TypeData::Anon { origin, .. } => match origin {
                Origin::ClassStatic(symbol)
                | Origin::Function(symbol)
                | Origin::EnumObject(symbol)
                | Origin::Module(symbol) => Found::Symbol(symbol),
                Origin::Namespace { module, .. } => Found::Symbol(module),
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    Found::Anonymous {
                        name: self.name_of_object_literal(file, e),
                        file,
                        declaration: Declaration::Expression(e),
                    }
                }
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => Found::Anonymous {
                    name: self.name_of_type_literal(file, node),
                    file,
                    declaration: Declaration::TypeNode(node),
                },
                Origin::GlobalThis => Found::Undeclared("globalThis".to_owned()),
            },
            // A function expression or an arrow function.
            TypeData::Fns { ref decls, .. } => {
                let &(file, function) = decls.first()?;
                let bound = self.c.bound(file);
                let symbol = bound.fn_symbol[function.idx()];
                if symbol.is_some() && self.c.hir(file)[function].name.is_some() {
                    return Some(Found::Symbol(files.sym(file, symbol)));
                }
                match bound.fns[function.idx()].owner {
                    FnOwner::Expr(e) => Found::Anonymous {
                        name: self.c.name_of_function_expression(file, e),
                        file,
                        declaration: Declaration::Expression(e),
                    },
                    // `() => T`, `new () => T`
                    FnOwner::Type(node) => Found::Anonymous {
                        name: self.name_of_type_literal(file, node),
                        file,
                        declaration: Declaration::TypeNode(node),
                    },
                    _ => return None,
                }
            }
            _ => return None,
        })
    }

    /// `getNameOfSymbolAsWritten`, of the symbol of an object literal: the variable it initializes names it.
    fn name_of_object_literal(&self, file: FileId, e: ExprId) -> String {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if let Parent::VarInit(declaration) = bound.expr_parent[e.idx()]
            && !is_parenthesized(self.c.hir(file), e)
        {
            let pat = hir[declaration].pat;
            return self
                .c
                .source_text(file, hir[pat].pos, self.c.end_of_pat(file, pat));
        }
        "__object".to_owned()
    }

    /// The same for the symbol of a type literal: the variable it is the type of names it.
    fn name_of_type_literal(&self, file: FileId, node: TypeNodeId) -> String {
        let hir = self.c.hir(file);
        match hir
            .var_decls
            .iter()
            .find(|declaration| declaration.ty == node)
        {
            Some(declaration) => self.c.source_text(
                file,
                hir[declaration.pat].pos,
                self.c.end_of_pat(file, declaration.pat),
            ),
            None => "__type".to_owned(),
        }
    }

    // ───────────────────────────── `symbol.Declarations` ─────────────────────────────

    fn declarations_of_symbol(&mut self, symbol: Sym) -> Vec<(FileId, Declaration)> {
        // Those of a class or an interface are declared among its members.
        if let [(file, Decl::TypeParam(parameter))] = self.c.files().decls_of(symbol)[..] {
            return self.declarations_of_member(file, MemberDeclaration::TypeParameter(parameter));
        }
        let exported = self.declarations_of_symbol_alone(symbol);
        match self.static_member_of_the_name(symbol) {
            Some((file, member)) => {
                let members = self.declarations_of_member_alone(file, member);
                self.in_order_of_binding(members, exported)
            }
            None => exported,
        }
    }

    /// The declarations of one symbol that we keep as two, in the order the binder comes to them: in one file, as they are written.
    fn in_order_of_binding(
        &self,
        mut first: Vec<(FileId, Declaration)>,
        mut second: Vec<(FileId, Declaration)>,
    ) -> Vec<(FileId, Declaration)> {
        if let (Some(&(file, a)), Some(&(other, b))) = (first.first(), second.first())
            && file == other
            && self.pos_of_declaration(file, b) < self.pos_of_declaration(file, a)
        {
            std::mem::swap(&mut first, &mut second);
        }
        first.append(&mut second);
        first
    }

    /// `declareClassMember`, `declareModuleMember`: the static members of a class and what a namespace that is one with the class
    /// exports are in one table, `symbol.Exports`. The static member that is one symbol with `symbol`, which is no value.
    fn static_member_of_the_name(&self, symbol: Sym) -> Option<(FileId, MemberDeclaration)> {
        let files = self.c.files();
        let declared = files.symbol(symbol);
        if declared.parent.is_none() || declared.flags.intersects(SymFlags::VALUE) {
            return None;
        }
        let class = files.sym(symbol.file, declared.parent);
        if !files.flags(class).contains(SymFlags::CLASS)
            || files.export(class, declared.name) != Some(symbol)
        {
            return None;
        }
        files.decls_of(class).iter().find_map(|&(file, decl)| {
            let Decl::Class(class) = decl else {
                return None;
            };
            let hir = self.c.hir(file);
            let member = hir[class].members.iter().find(|&m| {
                hir[m].flags.contains(Flags::STATIC) && hir[m].key == PropKey::Name(declared.name)
            })?;
            Some((file, MemberDeclaration::Member(member)))
        })
    }

    /// The other way: what is exported under the name of the static member `declaration`, if it is no value.
    fn export_of_the_name(&self, file: FileId, declaration: MemberDeclaration) -> Option<Sym> {
        let MemberDeclaration::Member(member) = declaration else {
            return None;
        };
        let (hir, files) = (self.c.hir(file), self.c.files());
        let PropKey::Name(name) = hir[member].key else {
            return None;
        };
        if !hir[member].flags.contains(Flags::STATIC) {
            return None;
        }
        let export = files.export(self.container_of_member(file, member)?, name)?;
        (!files.flags(export).intersects(SymFlags::VALUE)).then_some(export)
    }

    fn declarations_of_symbol_alone(&mut self, symbol: Sym) -> Vec<(FileId, Declaration)> {
        let mut declarations = Vec::new();
        for &part in self.c.files().parts(symbol).iter() {
            let of_part = self.c.bound(part.file).declarations_of_symbol(part.id);
            declarations.extend(
                of_part
                    .into_iter()
                    .map(|decl| (part.file, Declaration::Bound(decl))),
            );
        }
        declarations
    }

    /// `symbol.Declarations`, of the symbol of a member.
    fn declarations_of_member(
        &mut self,
        file: FileId,
        declaration: MemberDeclaration,
    ) -> Vec<(FileId, Declaration)> {
        let members = self.declarations_of_member_alone(file, declaration);
        match self.export_of_the_name(file, declaration) {
            Some(export) => {
                let exported = self.declarations_of_symbol_alone(export);
                self.in_order_of_binding(members, exported)
            }
            None => members,
        }
    }

    fn declarations_of_member_alone(
        &mut self,
        file: FileId,
        declaration: MemberDeclaration,
    ) -> Vec<(FileId, Declaration)> {
        let declarations = self.c.declarations_of_member(file, declaration);
        let of_member = |&(file, declaration): &(FileId, MemberDeclaration)| {
            let declaration = match declaration {
                MemberDeclaration::TypeParameter(it) => Declaration::Bound(Decl::TypeParam(it)),
                MemberDeclaration::Member(member) => Declaration::Member(member),
                MemberDeclaration::Parameter(parameter) => Declaration::Parameter(parameter),
                MemberDeclaration::Assignment(assignment) => Declaration::Expression(assignment),
                MemberDeclaration::Property(property) => Declaration::Property(property),
            };
            (file, declaration)
        };
        declarations.iter().map(of_member).collect()
    }

    fn declarations_of_property(&mut self, prop: &Prop, depth: u32) -> Vec<(FileId, Declaration)> {
        match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, member)) => {
                    self.declarations_of_member(file, MemberDeclaration::Member(member))
                }
                None => Vec::new(),
            },
            PropSource::Parameter(file, parameter) => {
                self.declarations_of_member(*file, MemberDeclaration::Parameter(*parameter))
            }
            PropSource::Literal(file, property) => {
                self.declarations_of_member(*file, MemberDeclaration::Property(*property))
            }
            PropSource::Symbol(symbol) => self.declarations_of_symbol(*symbol),
            PropSource::Assigned(file, assignments) => {
                // `this.name = value` is one symbol with a member `name` that comes after it.
                let of_this = assignments.first().map(|&first| {
                    self.declarations_of_member(*file, MemberDeclaration::Assignment(first))
                });
                match of_this {
                    Some(declarations) if declarations.len() > 1 => declarations,
                    _ => assignments
                        .iter()
                        .map(|&assignment| (*file, Declaration::Expression(assignment)))
                        .collect(),
                }
            }
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _) => {
                let mut declarations = Vec::new();
                for part in parts.iter() {
                    declarations.extend(self.declarations_of_property(part, depth));
                }
                declarations
            }
            // `depth`: a mapped type over itself leads round in a circle. tsgo sets `Declarations` once, while the type is resolved.
            PropSource::Mapped(of, _) if depth < 1000 => {
                match self.c.synthetic_origin_of_mapped_property(*of, prop.name) {
                    Some(origin) => self.declarations_of_property(&origin, depth + 1),
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    /// The class or interface `member` is declared in.
    fn container_of_member(&self, file: FileId, member: MemberId) -> Option<Sym> {
        let bound = self.c.bound(file);
        let symbol = match bound.member_owner[member.idx()] {
            MemberOwner::Class(class) => bound.class_symbol[class.idx()],
            MemberOwner::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => return None,
        };
        symbol.is_some().then(|| self.c.files().sym(file, symbol))
    }

    /// `symbol.Parent`, of a property. The symbol of a type literal or an object literal is never written.
    fn parent_of_property(&mut self, prop: &Prop) -> Option<PropertyParent> {
        let (file, member) = match &prop.source {
            PropSource::Members(list) => *list.first()?,
            PropSource::Copy(_, of, true) => return self.parent_of_property(&of[0]),
            PropSource::Parameter(..) => {
                return self.c.declaring_class(prop).map(PropertyParent::Symbol);
            }
            PropSource::Assigned(file, assignments) => {
                if let Some(class) = self.c.declaring_class(prop) {
                    return Some(PropertyParent::Symbol(class));
                }
                // `bindExpandoPropertyAssignment`
                let first = *assignments.first()?;
                let (bound, files) = (self.c.bound(*file), self.c.files());
                let declared = bound.expr_symbol[first.idx()];
                if declared.is_none() {
                    return None;
                }
                let parent = bound.symbols[declared.idx()].parent;
                let owner = &bound.symbols[parent.idx()];
                return match (owner.name, owner.decls[0]) {
                    (known::anonymous_function, Decl::Fn(function)) => {
                        let FnOwner::Expr(e) = bound.fns[function.idx()].owner else {
                            return None;
                        };
                        Some(PropertyParent::Named(
                            self.c.name_of_function_expression(*file, e),
                        ))
                    }
                    (known::object_literal, _) => None,
                    _ => Some(PropertyParent::Symbol(files.sym(*file, parent))),
                };
            }
            _ => return None,
        };
        self.container_of_member(file, member)
            .map(PropertyParent::Symbol)
    }

    // ───────────────────────────── `declaration.Pos()` ─────────────────────────────

    /// `Decl(a.ts, 3, 11)`
    fn push_declaration(&mut self, text: &mut String, file: FileId, declaration: Declaration) {
        let path = &self.c.files().module(file).path;
        let file_name = path.rsplit('/').next().unwrap_or(path);
        text.push_str("Decl(");
        text.push_str(file_name);
        // `isDefaultLibraryFile`
        if file_name.starts_with("lib.") && file_name.ends_with(".d.ts") {
            text.push_str(", --, --)");
            return;
        }
        let pos = self.pos_of_declaration(file, declaration);
        let (line, character) = self.line_and_character(file, pos);
        text.push_str(&format!(", {line}, {character})"));
    }

    /// `declaration.Pos()`
    fn pos_of_declaration(&self, file: FileId, declaration: Declaration) -> u32 {
        let hir = self.c.hir(file);
        // Where the first token starts, and the flags of the declaration.
        let (start, flags) = match declaration {
            Declaration::Bound(decl) => match self.c.files().loc_of_declaration(file, decl) {
                Some(loc) => return loc.pos,
                None => (
                    self.c.files().start_of_declaration(file, decl),
                    match decl {
                        Decl::Fn(function) => hir[function].flags,
                        Decl::TypeParam(parameter) => hir[parameter].flags,
                        _ => Flags::empty(),
                    },
                ),
            },
            Declaration::Member(member) => return hir[member].loc.pos,
            Declaration::Parameter(parameter) => return hir[parameter].loc.pos,
            Declaration::Property(property) => (hir[property].start, Flags::empty()),
            Declaration::Expression(e) => {
                (self.c.start_inside_parentheses(file, e), Flags::empty())
            }
            Declaration::TypeNode(node) => (hir[node].pos, Flags::empty()),
            Declaration::ThisParameter(function) => {
                let this = &hir[hir[function].this_param];
                (this.pos, this.flags)
            }
        };
        // Where the token before it ends. `finishReparsedNode`: what is made of a JSDoc tag is where the tag is, and the scanner of
        // JSDoc comments has no trivia.
        if flags.contains(Flags::REPARSED) {
            start
        } else {
            self.c.end_of_token_before(file, start)
        }
    }

    /// `GetECMALineAndUTF16CharacterOfPosition`
    fn line_and_character(&mut self, file: FileId, pos: u32) -> (usize, usize) {
        let text = &self.c.hir(file).text[..];
        let starts = self
            .line_starts
            .entry(file)
            .or_insert_with(|| compute_ecma_line_starts(text));
        let line = starts.partition_point(|&start| start <= pos) - 1;
        let to = (pos as usize).min(text.len());
        let from = (starts[line] as usize).min(to);
        let character: usize = text[from..to].iter().map(|&byte| utf16_length(byte)).sum();
        (line, character)
    }

    // ───────────────────────────── `symbolToString` ─────────────────────────────

    fn describe_symbol(
        &mut self,
        symbol: Sym,
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        // `lookupSymbolChainWorker`
        let flags = self.c.files().flags(symbol);
        let is_type_parameter = flags.contains(SymFlags::TYPE_PARAMETER);
        let (starts_with_global_this, chain) = if is_type_parameter {
            (false, vec![symbol])
        } else {
            self.c.lookup_symbol_chain_for_symbol_to_string(
                symbol,
                false,
                Enclosing::at_scope(self.file, at),
            )
        };
        (
            self.symbol_chain_to_string(starts_with_global_this, &chain, at),
            self.declarations_of_symbol(symbol),
        )
    }

    fn describe_property(
        &mut self,
        prop: &Prop,
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        match &prop.source {
            PropSource::Symbol(symbol) => return self.describe_symbol(*symbol, at),
            // The name, the parent and the declarations of what it is a copy of.
            PropSource::Copy(_, of, true) if of.len() == 1 => {
                return self.describe_property(&of[0], at);
            }
            PropSource::Intersected(_, parts) => {
                // `isInstantiation`: instantiations of one property that have the same type are one property.
                let mut prop_set: Vec<Prop> = Vec::new();
                for part in parts.iter() {
                    if let Some(single) = prop_set.first().cloned()
                        && single.source == part.source
                        && self.c.type_of_prop(&single, MapperId::IDENTITY)
                            == self.c.type_of_prop(part, MapperId::IDENTITY)
                    {
                        continue;
                    }
                    prop_set.push(part.clone());
                }
                return match &prop_set[..] {
                    [single] => self.describe_property(single, at),
                    _ => self.describe_properties(&prop_set, at),
                };
            }
            _ => {}
        }
        let declarations = self.declarations_of_property(prop, 0);
        if let Some(alias) = self.c.accessible_alias_of_property_at(prop, self.file, at) {
            return (
                self.symbol_chain_to_string(false, &[alias], at),
                declarations,
            );
        }
        // `getNameOfSymbolAsWritten`: as the first declaration writes it.
        let source = match declarations.first() {
            Some(&(file, Declaration::Member(member))) => {
                PropSource::Members(vec![(file, member)].into())
            }
            Some(&(file, Declaration::Parameter(parameter))) => {
                PropSource::Parameter(file, parameter)
            }
            Some(&(file, Declaration::Property(property))) => PropSource::Literal(file, property),
            _ => prop.source.clone(),
        };
        let name = self.c.prop_to_string(&Prop {
            source,
            ..prop.clone()
        });
        // `lookupSymbolChainWorker`: `class C<T> { T: number }` is one symbol, and a type parameter is not qualified.
        let is_type_parameter = |declaration: &(FileId, Declaration)| {
            matches!(declaration.1, Declaration::Bound(Decl::TypeParam(_)))
        };
        let parent = match declarations.iter().any(is_type_parameter) {
            true => None,
            false => self.parent_of_property(prop),
        };
        (self.qualified_by_parent(parent, name, at), declarations)
    }

    /// `createUnionOrIntersectionProperty`: all the declarations, and the parent of the value declaration if there is only one.
    fn describe_properties(
        &mut self,
        props: &[Prop],
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        let mut declarations = Vec::new();
        let mut first_value_declaration = None;
        let mut has_non_uniform_value_declaration = false;
        for prop in props {
            let own = self.declarations_of_property(prop, 0);
            match (first_value_declaration, own.first()) {
                (None, Some(&first)) => first_value_declaration = Some(first),
                (Some(known), Some(&first)) if known != first => {
                    has_non_uniform_value_declaration = true;
                }
                _ => {}
            }
            declarations.extend(own);
        }
        let Some(first) = props.first() else {
            return (String::new(), declarations);
        };
        let name = self.c.prop_to_string(first);
        let parent = if has_non_uniform_value_declaration {
            None
        } else {
            self.parent_of_property(first)
        };
        (self.qualified_by_parent(parent, name, at), declarations)
    }

    /// `getSymbolChain`, of a symbol that is in no table: the chain of its parent, and `name`.
    fn qualified_by_parent(
        &mut self,
        parent: Option<PropertyParent>,
        name: String,
        at: ScopeId,
    ) -> String {
        let mut text = match parent {
            None => return name,
            Some(PropertyParent::Named(parent)) => parent,
            Some(PropertyParent::Symbol(parent)) => {
                let (starts_with_global_this, chain) =
                    self.c.lookup_symbol_chain_for_symbol_to_string(
                        parent,
                        true,
                        Enclosing::at_scope(self.file, at),
                    );
                if chain.is_empty() {
                    return name;
                }
                self.symbol_chain_to_string(starts_with_global_this, &chain, at)
            }
        };
        push_access(&mut text, &name, false);
        text
    }

    /// `createExpressionFromSymbolChain`
    fn symbol_chain_to_string(
        &mut self,
        starts_with_global_this: bool,
        chain: &[Sym],
        at: ScopeId,
    ) -> String {
        let mut text = String::new();
        if starts_with_global_this {
            text.push_str("globalThis");
        }
        for (index, &symbol) in chain.iter().enumerate() {
            let is_initial = index == 0 && !starts_with_global_this;
            let name = self.get_name_of_symbol_as_written(symbol, is_initial, at);
            if is_initial {
                text = name;
            } else {
                let is_enum_member = self.c.files().flags(symbol).contains(SymFlags::ENUM_MEMBER);
                push_access(&mut text, &name, is_enum_member);
            }
        }
        text
    }

    /// `getNameOfSymbolAsWritten`, and the specifier `createExpressionFromSymbolChain` writes for an external module. `is_initial`:
    /// `FlagsInInitialEntityName`.
    fn get_name_of_symbol_as_written(
        &mut self,
        symbol: Sym,
        is_initial: bool,
        at: ScopeId,
    ) -> String {
        let files = self.c.files();
        let declared = files.symbol(symbol);
        // `InternalSymbolNameMissing`: a class declaration without a name that is no default export. The binder keeps it as `default`.
        if let [Decl::Class(class)] = declared.decls[..]
            && self.c.hir(symbol.file)[class].name.is_none()
            && !self.c.hir(symbol.file)[class]
                .flags
                .contains(Flags::DEFAULT)
            && matches!(
                self.c.bound(symbol.file).class_owner[class.idx()],
                ClassOwner::Stmt(_)
            )
        {
            return "__missing".to_owned();
        }
        let is_default_export = declared.name == known::default;
        // `isDefaultBindingContext`, as far as files go.
        if is_default_export && (!is_initial || symbol.file != self.file) {
            return "default".to_owned();
        }
        let name = self.c.symbol_to_string(symbol);
        // `startsWithSingleOrDoubleQuote`: a function that `declare module "m" {}` adds to goes by its own name.
        if name.starts_with(['"', '\'']) && self.is_external_module(symbol) {
            let specifier = self
                .c
                .specifier_for_module_symbol_at(symbol, Enclosing::at_scope(self.file, at));
            // `getSpecifierForModuleSymbol`: without a file, `StripQuotes(symbol.Name)` (`isAmbientModuleSymbolName`).
            if !specifier.is_empty() {
                return super::print::quoted(&specifier, '"', true);
            }
        }
        name
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    fn is_external_module(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        files
            .decls(symbol)
            .into_iter()
            .any(|(file, decl)| match decl {
                // `IsExternalOrCommonJSModule`, which a JSON file is not.
                Decl::File => {
                    files.module(file).is_module() && self.c.hir(file).kind != FileKind::Json
                }
                Decl::Module(module) => {
                    matches!(self.c.hir(file)[module].name, ModuleName::String(_))
                }
                _ => false,
            })
    }
}

/// Whether a `#x` or a number is written at `pos`, where the tree keeps no name.
fn is_written_name(hir: &hir::File, pos: u32) -> bool {
    matches!(hir.text.get(pos as usize), Some(b'#' | b'0'..=b'9'))
}

/// `createExpressionFromSymbolChain`, past the first symbol: `.name`, or `[name]` for what is no identifier. The brackets of a
/// computed name are not doubled.
fn push_access(text: &mut String, name: &str, is_enum_member: bool) {
    let bare = name.strip_prefix('#').unwrap_or(name);
    // `canUsePropertyAccess`
    if bun_core::lexer::is_identifier(bare.as_bytes()) {
        text.push('.');
        text.push_str(name);
        return;
    }
    let inner = match name.strip_prefix('[') {
        Some(rest) => &rest[..rest.len().saturating_sub(1)],
        None => name,
    };
    text.push('[');
    match inner.chars().next() {
        // A string literal of what is between the first and the last character, whatever that is.
        Some(quote @ ('"' | '\'')) if !is_enum_member => {
            text.push_str(&super::print::quoted(&unquote_string(inner), quote, true));
        }
        _ => text.push_str(inner),
    }
    text.push(']');
}

/// `stringutil.UnquoteString`
fn unquote_string(text: &str) -> String {
    let mut chars = text.chars();
    let inner = match (chars.next(), chars.next_back()) {
        (Some(first), Some(last)) if first == last => chars.as_str(),
        _ => text,
    };
    let mut unquoted = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        match ch {
            // `\\.` does not match a line break.
            '\\' => match chars.next() {
                Some('\n') => unquoted.push_str("\\\n"),
                Some(next) => unquoted.push(next),
                None => unquoted.push(ch),
            },
            _ => unquoted.push(ch),
        }
    }
    unquoted
}

/// How many UTF-16 code units the character takes whose UTF-8 encoding `byte` is a byte of, counted at its first byte.
fn utf16_length(byte: u8) -> usize {
    match byte {
        0x80..=0xBF => 0,
        0xF0..=0xFF => 2,
        _ => 1,
    }
}
