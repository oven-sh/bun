//! The symbol at every name of a file: what TypeScript's test harness writes into `.symbols` baselines
//! (`typeWriterWalker.getSymbols`, `GetSymbolAtLocation`, `SymbolToStringEx`).
//!
//! Members of classes, interfaces, type literals and object literals have no `SymbolId`: such a symbol is a [`Prop`], and its
//! declarations are those the binder and `lateBindMember` have put together with the first of them.

use super::visit_node::{VisitedKind, VisitedNode};
use super::*;
use crate::bind::{Decl, FnOwner, MemberDeclaration, MemberOwner, Parent, PatParent, ScopeId};
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

const FUNCTION_MODIFIERS: &[&[u8]] = &[b"function", b"async", b"export", b"default", b"declare"];
const CLASS_MODIFIERS: &[&[u8]] = &[b"class", b"abstract", b"export", b"default", b"declare"];
const INTERFACE_MODIFIERS: &[&[u8]] = &[b"interface", b"export", b"default", b"declare"];
const TYPE_ALIAS_MODIFIERS: &[&[u8]] = &[b"type", b"export", b"declare"];
const ENUM_MODIFIERS: &[&[u8]] = &[b"enum", b"const", b"export", b"declare"];
const MODULE_MODIFIERS: &[&[u8]] = &[b"namespace", b"module", b"export", b"declare"];
const TYPE_PARAMETER_MODIFIERS: &[&[u8]] = &[b"const", b"in", b"out"];
const IMPORT_EQUALS_MODIFIERS: &[&[u8]] = &[b"import", b"export", b"type"];
const EXPORT_ASSIGNMENT_MODIFIERS: &[&[u8]] = &[b"export", b"default"];
const PARAMETER_MODIFIERS: &[&[u8]] = &[
    b"public",
    b"private",
    b"protected",
    b"readonly",
    b"override",
];
const MEMBER_MODIFIERS: &[&[u8]] = &[
    b"public",
    b"private",
    b"protected",
    b"static",
    b"readonly",
    b"abstract",
    b"override",
    b"declare",
    b"accessor",
    b"async",
    b"get",
    b"set",
];
const OBJECT_LITERAL_MEMBER_MODIFIERS: &[&[u8]] = &[b"async", b"get", b"set"];
const IMPORT_CLAUSE_MODIFIERS: &[&[u8]] = &[b"type", b"defer"];
const SPECIFIER_MODIFIERS: &[&[u8]] = &[b"type"];
/// The `as` of `* as ns`.
const NAMESPACE_IMPORT_MODIFIERS: &[&[u8]] = &[b"as"];
const NO_MODIFIERS: &[&[u8]] = &[];
const NO_PUNCTUATION: &[u8] = b"";
const ASTERISK: &[u8] = b"*";
const EQUALS: &[u8] = b"=";
/// The dots of `...rest`.
const DOT: &[u8] = b".";
/// And the bracket of `[computed]: local`.
const DOT_OR_BRACKET: &[u8] = b".[";

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
                if !self.is_declaration_of_symbol(symbol, file, decl) {
                    return None;
                }
                if matches!(kind, VisitedKind::DeclarationName(..)) {
                    return Some(Found::Symbol(symbol));
                }
                // `getImmediateAliasedSymbol`: the `a` of `import { a as b }` and of `export { a as b }`.
                let target = files.alias_target(symbol)?;
                Some(Found::Symbol(files.canonical(target)))
            }
            // `IsLiteralComputedPropertyDeclarationName`: the literal in `["name"]`, `` [`name`] `` and `[0]` has the symbol of the
            // declaration.
            VisitedKind::LiteralInEnumMemberName(m) => Some(Found::Symbol(
                files.sym(file, bound.enum_member_symbol[m.idx()]),
            )),
            VisitedKind::MemberName(m) | VisitedKind::LiteralInMemberName(m) => {
                (!matches!(hir[m].key, PropKey::None)).then(|| self.property_of_member(m))
            }
            VisitedKind::PropertyName(p) | VisitedKind::LiteralInPropertyName(p) => {
                let name = hir[p].key.name().unwrap_or(Atom::NONE);
                (!matches!(hir[p].key, PropKey::None)).then(|| {
                    Found::Property(Prop {
                        name,
                        flags: PropFlags::empty(),
                        source: PropSource::Literal(file, p),
                        mapper: MapperId::IDENTITY,
                    })
                })
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
                let ty = self.c.type_of_pat(file, pattern);
                self.get_property_of_type(ty, name)
            }
            VisitedKind::ThisParameter(f) => Some(this_parameter(file, f)),
            VisitedKind::Expression(e) | VisitedKind::AccessName(e) => {
                let is_name = matches!(kind, VisitedKind::AccessName(_));
                self.get_symbol_of_expression(e, is_name)
            }
            // A type reference that resolves to nothing.
            VisitedKind::ConstOfAsConst(_) => Some(Found::Undeclared("const".to_owned())),
            // `getIntrinsicTagSymbol`
            VisitedKind::JsxIntrinsicTagName(_, tag) => {
                let ExprKind::String(name) = hir[tag].kind else {
                    return None;
                };
                let elements = self.c.jsx_type(file, known::IntrinsicElements)?;
                match self.c.prop_of(elements, name) {
                    Some((prop, _)) => Some(Found::Property(prop)),
                    None => self.get_applicable_index_symbol(elements, name),
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
                match files.resolve_entity(file, scope, &names, meaning) {
                    Some(symbol) => Some(Found::Symbol(symbol)),
                    None if !matches!(kind, VisitedKind::TypeReferenceName(..)) => None,
                    // `getUnresolvedSymbolForEntityName`, which is `unknownSymbol` for a name the parser missed.
                    None if names[..] == [known::empty] => {
                        Some(Found::Undeclared("unknown".to_owned()))
                    }
                    None => {
                        let path: Vec<_> =
                            names.iter().map(|&part| files.atoms.text(part)).collect();
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
                for (at, part) in hir.ids(name).enumerate().take(index as usize + 1) {
                    let meaning = if at + 1 < name.len() {
                        SymFlags::NAMESPACE
                    } else if is_typeof {
                        SymFlags::VALUE
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
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::TaggedTemplateLiteral(_)
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
                if self.c.is_apparently_unknown(ty) {
                    return None;
                }
                match self.get_property_of_type(ty, name) {
                    Some(found) => Some(found),
                    None if self.c.is_private_name(name) => None,
                    None => {
                        let ty = self.c.apparent_type(ty);
                        self.get_applicable_index_symbol(ty, name)
                    }
                }
            }
            ExprKind::String(_) | ExprKind::Number(_) | ExprKind::Template { .. } => {
                self.get_symbol_of_literal(e)
            }
            ExprKind::This => {
                let this_parameter = match self.c.this_container(file, e) {
                    Some(Ok(function)) => self.this_parameter_of_function(function),
                    _ => None,
                };
                match this_parameter {
                    Some(found) => Some(found),
                    None => {
                        let ty = self.c.type_of_expr(file, e);
                        self.symbol_of_type(ty)
                    }
                }
            }
            // The `meta` of `import.meta` is the member of `getGlobalImportMetaExpressionType`.
            ExprKind::ImportMeta if is_name => {
                Some(Found::Undeclared("ImportMetaExpression.meta".to_owned()))
            }
            // `checkExpression(node).symbol`. The `target` of `new.target` has the same symbol.
            ExprKind::Super | ExprKind::ImportMeta | ExprKind::NewTarget => {
                let ty = self.c.type_of_expr(file, e);
                self.symbol_of_type(ty)
            }
            _ => None,
        }
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
        match hir[parent].kind {
            // `a["name"]`, `a[0]`
            ExprKind::Index { obj, index, .. } if index == e && !is_parenthesized(hir, e) => {
                let name = match hir[e].kind {
                    ExprKind::String(text) => text,
                    ExprKind::Number(number) => self.c.number_name(hir.numbers[number as usize]),
                    ExprKind::Template { exprs, texts } if exprs.is_empty() => {
                        hir.ids(texts).next()?
                    }
                    _ => return None,
                };
                let ty = self.c.type_of_expr(file, obj);
                self.get_property_of_type(ty, name)
            }
            // `resolveExternalModuleName`
            ExprKind::ImportCall(written) if written == e => {
                specifier(files.mode_of_import_call(file))
            }
            // `IsVariableDeclarationInitializedToRequire`
            ExprKind::Call(_)
                if hir.is_js
                    && matches!(bound.expr_parent[parent.idx()], Parent::VarInit(_))
                    && crate::bind::require_argument(hir, parent) == Some(e) =>
            {
                specifier(ResolutionMode::Require)
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
        if self.c.start_of_this_parameter(file, function).is_some() {
            return Some(this_parameter(file, function));
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
        self.c
            .start_of_this_parameter(file, function)
            .map(|_| this_parameter(file, function))
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

    /// `getSymbolOfNameOrPropertyAccessExpression`, of an identifier that is an expression.
    fn get_symbol_of_identifier(&self, e: ExprId, name: Atom) -> Option<Found> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
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
        match self.c.symbol_of_identifier(file, e, name) {
            // `getSymbol`: an alias that stands for no value is not there.
            Some(symbol) => files
                .means(symbol, SymFlags::VALUE)
                .then_some(Found::Symbol(symbol)),
            None => match name {
                known::undefined | known::globalThis => {
                    Some(Found::Undeclared(self.c.atom_text(name)))
                }
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
            return Some(Found::Property(prop));
        }
        // `createUnionOrIntersectionProperty`
        let mut prop_set: Vec<(Prop, MapperId)> = Vec::new();
        for part in self.c.parts_in_order(ty) {
            let part = self.c.apparent_type(part);
            if part == TypeId::NEVER {
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
        let members = self.c.members(ty)?;
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
        let parent = match *self.c.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) => Some(target),
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => Some(class),
            _ => None,
        };
        Some(Found::IndexSignature {
            parent,
            declarations,
        })
    }

    /// `t.symbol`
    fn symbol_of_type(&self, ty: TypeId) -> Option<Found> {
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
                Origin::ObjectLiteral(file, e) | Origin::WidenedLiteral(file, e) => {
                    Found::Anonymous {
                        name: self.name_of_object_literal(file, e),
                        file,
                        declaration: Declaration::Expression(e),
                    }
                }
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => Found::Anonymous {
                    name: "__type".to_owned(),
                    file,
                    declaration: Declaration::TypeNode(node),
                },
                Origin::GlobalThis => Found::Undeclared("globalThis".to_owned()),
            },
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

    // ───────────────────────────── `symbol.Declarations` ─────────────────────────────

    /// `declareSymbolEx`: a declaration that is refused the name is listed with what has it, and is a symbol of its own.
    fn is_declaration_of_symbol(&self, symbol: Sym, file: FileId, decl: Decl) -> bool {
        let bound = self.c.bound(file);
        let own = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => bound.pat_symbol[pat.idx()],
            Decl::Fn(function) => bound.fn_symbol[function.idx()],
            Decl::Class(class) => bound.class_symbol[class.idx()],
            Decl::Interface(interface) => bound.interface_symbol[interface.idx()],
            Decl::Alias(alias) => bound.alias_symbol[alias.idx()],
            Decl::Enum(enumeration) => bound.enum_symbol[enumeration.idx()],
            Decl::EnumMember(member) => bound.enum_member_symbol[member.idx()],
            Decl::Module(module) => bound.module_symbol[module.idx()],
            Decl::TypeParam(parameter) => bound.type_param_symbol[parameter.idx()],
            _ => return true,
        };
        own.is_none() || self.c.files().sym(file, own) == symbol
    }

    fn declarations_of_symbol(&mut self, symbol: Sym) -> Vec<(FileId, Declaration)> {
        let decls = self.c.files().decls(symbol);
        // Those of a class or an interface are declared among its members.
        if let [(file, Decl::TypeParam(parameter))] = decls[..] {
            return self.declarations_of_member(file, MemberDeclaration::TypeParameter(parameter));
        }
        decls
            .into_iter()
            .filter(|&(file, decl)| self.is_declaration_of_symbol(symbol, file, decl))
            .map(|(file, decl)| (file, Declaration::Bound(decl)))
            .collect()
    }

    /// `symbol.Declarations`, of the symbol of a member.
    fn declarations_of_member(
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
            // Overloads of which only the signatures are kept.
            PropSource::Type(_) => match self.c.first_declaration_of_overloads(prop) {
                Some((file, member)) => {
                    self.declarations_of_member(file, MemberDeclaration::Member(member))
                }
                None => Vec::new(),
            },
            PropSource::Intersected(_, parts) if depth < 8 => {
                let mut declarations = Vec::new();
                for part in parts.iter() {
                    declarations.extend(self.declarations_of_property(part, depth + 1));
                }
                declarations
            }
            PropSource::Mapped(of, _) if depth < 8 => {
                match self.synthetic_origin_of_mapped_property(*of, prop.name) {
                    Some(origin) => self.declarations_of_property(&origin, depth + 1),
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    /// `syntheticOrigin`: the property of the modifiers type that a property of a mapped type takes its declarations from.
    fn synthetic_origin_of_mapped_property(&mut self, of: TypeId, name: Atom) -> Option<Prop> {
        let (file, node, mapper) = self.c.mapped_origin(of)?;
        let mapped = self.c.mapped_decl(file, node);
        if self.c.hir(file)[mapped.param].constraint.is_none() {
            return None;
        }
        // `MappedTypeNameTypeKindRemapping`
        if let Some(renamed) = self.c.mapped_name_type(of) {
            let key = self.c.mapped_type_param(of);
            if !self.c.is_assignable(renamed, key) {
                return None;
            }
        }
        let (declared, _) = self.c.mapped_modifiers_source(file, node)?;
        let modifiers = self.c.instantiate(declared, mapper);
        let modifiers = self.c.apparent_type(modifiers);
        self.c.prop_of(modifiers, name).map(|found| found.0)
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
    fn parent_of_property(&self, prop: &Prop) -> Option<PropertyParent> {
        let (file, member) = match &prop.source {
            PropSource::Members(list) => *list.first()?,
            PropSource::Type(_) => self.c.first_declaration_of_overloads(prop)?,
            PropSource::Parameter(..) => {
                return self.c.declaring_class(prop).map(PropertyParent::Symbol);
            }
            PropSource::Assigned(file, assignments) => {
                if let Some(class) = self.c.declaring_class(prop) {
                    return Some(PropertyParent::Symbol(class));
                }
                // `bindExpandoPropertyAssignment`
                let first = *assignments.first()?;
                let (hir, bound, files) = (self.c.hir(*file), self.c.bound(*file), self.c.files());
                if let Some(expando) = bound
                    .declared_fn_expandos
                    .iter()
                    .find(|expando| expando.2 == first)
                {
                    return Some(PropertyParent::Symbol(files.sym(*file, expando.0)));
                }
                let function = bound
                    .fn_expr_expandos
                    .iter()
                    .find(|expando| expando.2 == first)?
                    .0;
                let symbol = bound.fn_symbol[function.idx()];
                if symbol.is_some() {
                    return Some(PropertyParent::Symbol(files.sym(*file, symbol)));
                }
                // `GetNameOfDeclaration`: the variable it initializes names it.
                let FnOwner::Expr(e) = bound.fns[function.idx()].owner else {
                    return None;
                };
                let Parent::VarInit(declaration) = bound.expr_parent[e.idx()] else {
                    return None;
                };
                let pat = hir[declaration].pat;
                return Some(PropertyParent::Named(self.c.source_text(
                    *file,
                    hir[pat].pos,
                    self.c.end_of_pat(*file, pat),
                )));
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

    /// `declaration.Pos()`: where the token before the declaration ends. The tree says where names and keywords start, so the
    /// modifiers and decorators before them are gone back over in the text.
    fn pos_of_declaration(&self, file: FileId, declaration: Declaration) -> u32 {
        let hir = self.c.hir(file);
        match declaration {
            Declaration::Bound(decl) => self.pos_of_bound_declaration(file, decl),
            Declaration::Member(member) => self.pos_before_modifiers(
                file,
                super::errors_x_properties_jsx::start_of_member_name(hir, member),
                MEMBER_MODIFIERS,
                ASTERISK,
                Some(DecoratorOwner::Member(member)),
            ),
            Declaration::Parameter(parameter) => self.pos_of_parameter(file, parameter),
            Declaration::Property(property) => self.pos_before_modifiers(
                file,
                hir[property].pos,
                OBJECT_LITERAL_MEMBER_MODIFIERS,
                ASTERISK,
                None,
            ),
            Declaration::Expression(e) => self
                .c
                .end_of_token_before(file, self.c.start_inside_parentheses(file, e)),
            Declaration::TypeNode(node) => self.c.end_of_token_before(file, hir[node].pos),
            Declaration::ThisParameter(function) => hir[function].anchor + 1,
        }
    }

    fn pos_of_bound_declaration(&self, file: FileId, decl: Decl) -> u32 {
        let hir = self.c.hir(file);
        let (anchor, modifiers, punctuation): (u32, &[&[u8]], &[u8]) = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                return self.pos_of_binding(file, pat);
            }
            Decl::Fn(function) => {
                let declared = &hir[function];
                let anchor = if declared.name.is_some() {
                    declared.name_pos
                } else {
                    declared.pos
                };
                (anchor, FUNCTION_MODIFIERS, ASTERISK)
            }
            Decl::Class(class) => {
                let declared = &hir[class];
                let anchor = if declared.name.is_some() {
                    declared.name_pos
                } else {
                    declared.pos
                };
                return self.pos_before_modifiers(
                    file,
                    anchor,
                    CLASS_MODIFIERS,
                    NO_PUNCTUATION,
                    Some(DecoratorOwner::Class(class)),
                );
            }
            Decl::Interface(interface) => {
                (hir[interface].name_pos, INTERFACE_MODIFIERS, NO_PUNCTUATION)
            }
            Decl::Alias(alias) => (hir[alias].name_pos, TYPE_ALIAS_MODIFIERS, NO_PUNCTUATION),
            Decl::Enum(enumeration) => (hir[enumeration].name_pos, ENUM_MODIFIERS, NO_PUNCTUATION),
            Decl::EnumMember(member) => (hir[member].pos, NO_MODIFIERS, NO_PUNCTUATION),
            Decl::Module(module) => (hir[module].name_pos, MODULE_MODIFIERS, NO_PUNCTUATION),
            Decl::TypeParam(parameter) => {
                (hir[parameter].pos, TYPE_PARAMETER_MODIFIERS, NO_PUNCTUATION)
            }
            // `ImportClause`: right after `import`.
            Decl::ImportDefault(import) => (
                hir[import].default_pos,
                IMPORT_CLAUSE_MODIFIERS,
                NO_PUNCTUATION,
            ),
            // `* as ns`
            Decl::ImportNamespace(import) => (
                hir[import].namespace_pos,
                NAMESPACE_IMPORT_MODIFIERS,
                ASTERISK,
            ),
            Decl::ImportSpec(spec) => (
                hir[spec].pos.min(hir[spec].imported_pos),
                SPECIFIER_MODIFIERS,
                NO_PUNCTUATION,
            ),
            Decl::ExportSpec(spec) => (
                hir[spec].pos.min(hir[spec].local_pos),
                SPECIFIER_MODIFIERS,
                NO_PUNCTUATION,
            ),
            Decl::ImportEquals(import) => (
                hir[import].name_pos,
                IMPORT_EQUALS_MODIFIERS,
                NO_PUNCTUATION,
            ),
            Decl::ExportStarAs(statement) => (
                self.c
                    .declaration_name_start(file, decl)
                    .unwrap_or(hir[statement].pos),
                NAMESPACE_IMPORT_MODIFIERS,
                ASTERISK,
            ),
            Decl::ExportExpr(statement) => {
                (hir[statement].pos, EXPORT_ASSIGNMENT_MODIFIERS, EQUALS)
            }
            Decl::UmdGlobal(statement) => (hir[statement].pos, NO_MODIFIERS, NO_PUNCTUATION),
            Decl::ModuleExports(e) | Decl::ExportsProperty(e) => (
                self.c.start_inside_parentheses(file, e),
                NO_MODIFIERS,
                NO_PUNCTUATION,
            ),
            Decl::File | Decl::CommonJsVariable => return 0,
        };
        self.pos_before_modifiers(file, anchor, modifiers, punctuation, None)
    }

    /// `Pos()` of the variable declaration, parameter or binding element that declares the name `pat`.
    fn pos_of_binding(&self, file: FileId, pat: PatId) -> u32 {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        match bound.pat_parent[pat.idx()] {
            PatParent::Param(parameter) => self.pos_of_parameter(file, parameter),
            // `name: local`, `[computed]: local`, `...rest`
            PatParent::Prop(_, element) => self.pos_before_modifiers(
                file,
                hir[element].pos.min(hir[pat].pos),
                NO_MODIFIERS,
                DOT_OR_BRACKET,
                None,
            ),
            PatParent::Elem(..) => {
                self.pos_before_modifiers(file, hir[pat].pos, NO_MODIFIERS, DOT, None)
            }
            PatParent::Var(_) | PatParent::None => self.c.end_of_token_before(file, hir[pat].pos),
        }
    }

    fn pos_of_parameter(&self, file: FileId, parameter: ParamId) -> u32 {
        self.pos_before_modifiers(
            file,
            self.c.hir(file)[parameter].pos,
            PARAMETER_MODIFIERS,
            DOT,
            Some(DecoratorOwner::Param(parameter)),
        )
    }

    /// Where the token ends that comes before what is written at `anchor`, its modifiers and its decorators.
    fn pos_before_modifiers(
        &self,
        file: FileId,
        anchor: u32,
        modifiers: &[&[u8]],
        punctuation: &[u8],
        decorated: Option<DecoratorOwner>,
    ) -> u32 {
        let mut start = self.start_of_modifiers(file, anchor, modifiers, punctuation);
        if let Some(owner) = decorated
            && let Some(decorator) = self.start_of_first_decorator(file, owner)
            && decorator < start
        {
            start = self.start_of_modifiers(file, decorator, modifiers, punctuation);
        }
        self.c.end_of_token_before(file, start)
    }

    /// Where the first of the words `modifiers` and the tokens `punctuation` that are written right before `at` starts.
    fn start_of_modifiers(
        &self,
        file: FileId,
        mut at: u32,
        modifiers: &[&[u8]],
        punctuation: &[u8],
    ) -> u32 {
        let text = &self.c.hir(file).text[..];
        loop {
            let end = (self.c.end_of_token_before(file, at) as usize).min(text.len());
            if end == 0 {
                return at;
            }
            if punctuation.contains(&text[end - 1]) {
                let mut start = end - 1;
                // `...`
                while text[start] == b'.' && start > 0 && text[start - 1] == b'.' {
                    start -= 1;
                }
                at = start as u32;
                continue;
            }
            let mut start = end;
            while start > 0 && is_identifier_part(text[start - 1]) {
                start -= 1;
            }
            // The `static` of `a.static` and of `#static` is no modifier.
            if !modifiers.contains(&&text[start..end])
                || start > 0 && matches!(text[start - 1], b'.' | b'#')
            {
                return at;
            }
            at = start as u32;
        }
    }

    /// Where the `@` of the first decorator of `owner` is.
    fn start_of_first_decorator(&self, file: FileId, owner: DecoratorOwner) -> Option<u32> {
        let hir = self.c.hir(file);
        let &(_, expression) = hir
            .decorators
            .iter()
            .find(|decorator| decorator.0 == owner)?;
        let after = self
            .c
            .end_of_token_before(file, self.c.start_of(file, expression));
        (after > 0 && hir.text.get(after as usize - 1) == Some(&b'@')).then(|| after - 1)
    }

    // ───────────────────────────── `symbolToString` ─────────────────────────────

    fn describe_symbol(
        &mut self,
        symbol: Sym,
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        // `lookupSymbolChainWorker`
        let is_type_parameter = self
            .c
            .files()
            .flags(symbol)
            .contains(SymFlags::TYPE_PARAMETER);
        let (starts_with_global_this, chain) = if is_type_parameter {
            (false, vec![symbol])
        } else {
            self.c
                .lookup_symbol_chain_for_symbol_to_string(symbol, false, self.file, at)
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
                let (starts_with_global_this, chain) = self
                    .c
                    .lookup_symbol_chain_for_symbol_to_string(parent, true, self.file, at);
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
        // The binder keeps `export default class C {}` under the name `C`.
        let is_default_export = declared.name == known::default
            || declared.parent.is_some()
                && files.export(files.sym(symbol.file, declared.parent), known::default)
                    == Some(symbol);
        // `isDefaultBindingContext`, as far as files go.
        if is_default_export && (!is_initial || symbol.file != self.file) {
            return "default".to_owned();
        }
        let name = self.c.symbol_to_string(symbol);
        // `startsWithSingleOrDoubleQuote`: a function that `declare module "m" {}` adds to goes by its own name.
        if name.starts_with(['"', '\'']) && self.is_external_module(symbol) {
            let specifier = self.c.specifier_for_module_symbol_at(symbol, self.file, at);
            return super::print::quoted(&specifier, '"', true);
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

fn this_parameter(file: FileId, function: FnId) -> Found {
    Found::Anonymous {
        name: "this".to_owned(),
        file,
        declaration: Declaration::ThisParameter(function),
    }
}
/// `createExpressionFromSymbolChain`, past the first symbol: `.name`, or `[name]` for what is no identifier. The brackets of a
/// computed name are not doubled.
fn push_access(text: &mut String, name: &str, is_enum_member: bool) {
    let bare = name.strip_prefix('#').unwrap_or(name);
    // `canUsePropertyAccess`
    if !bare.is_empty()
        && !bare.as_bytes()[0].is_ascii_digit()
        && bare.bytes().all(is_identifier_part)
    {
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
