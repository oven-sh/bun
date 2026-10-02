//! The symbol at every name of a file: what TypeScript's test harness writes into `.symbols` baselines
//! (`typeWriterWalker.getSymbols`, `GetSymbolAtLocation`, `SymbolToStringEx`).
//!
//! Members of classes, interfaces, type literals and object literals have no `SymbolId`: such a symbol is a [`Prop`], and its
//! declarations are found again from the first of them, as `declareSymbolEx` would have put them together.

use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind, SymbolId};
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
        file: FileId,
        member: MemberId,
    },
}

/// `symbol.Parent`, of a property.
enum PropertyParent {
    Symbol(Sym),
    /// A function expression that has no `SymbolId`, by the name `getNameOfSymbolAsWritten` gives it.
    Named(String),
}

const PROPERTY: u8 = 1;
const METHOD: u8 = 2;
const GET_ACCESSOR: u8 = 4;
const SET_ACCESSOR: u8 = 8;
const ACCESSOR: u8 = GET_ACCESSOR | SET_ACCESSOR;

/// A declaration of a member, with the `includes` and `excludes` it is declared with.
type MemberDeclaration = (FileId, Declaration, u8, u8);

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
        // The nodes of a JSON file have no positions.
        if self.hir(file).kind == FileKind::Json {
            return Vec::new();
        }
        let mut writer = SymbolWriter::new(self, file);
        // A range is written once: a declaration name comes before the expression or the type that is kept at the same place.
        writer.write_declaration_names();
        writer.write_member_names();
        writer.write_property_names();
        writer.write_binding_names();
        writer.write_expressions();
        writer.write_jsx_intrinsic_tag_names();
        writer.write_type_nodes();
        writer.write_import_equals_references();
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

    /// `writeTypeOrSymbol`, of the node from `start` to `end`. `scope`: `enclosingDeclaration`, which is `node.Parent`.
    fn write(&mut self, start: u32, end: u32, scope: ScopeId, found: Found) {
        let hir = self.c.hir(self.file);
        // `NodeFlagsInWithStatement`, `NodeFlagsReparsed`
        if start >= end
            || hir.is_in_with(start)
            || hir.is_in_jsdoc(start)
            || !self.written.insert((start, end))
        {
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
                file,
                member,
            } => (
                self.qualified_by_parent(
                    parent.map(PropertyParent::Symbol),
                    "__index".to_owned(),
                    scope,
                ),
                vec![(*file, Declaration::Member(*member))],
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

    /// `IsDeclarationNameOrImportPropertyName`, of the declarations that have a `SymbolId`. Variables and parameters are patterns.
    fn write_declaration_names(&mut self) {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        for index in 0..bound.symbols.len() {
            let symbol = files.sym(file, SymbolId(index as u32));
            for &decl in bound.symbols[index].decls.as_slice() {
                if !self.is_declaration_of_symbol(symbol, file, decl) {
                    continue;
                }
                let Some(start) = self.name_start_of_declaration(decl) else {
                    continue;
                };
                let scope = self.enclosing_scope_of_declaration_name(decl);
                let end = self.c.end_of_name_at(file, start);
                self.write(start, end, scope, Found::Symbol(symbol));
                // `getImmediateAliasedSymbol`: the `a` of `import { a as b }` and of `export { a as b }`.
                let property_name = match decl {
                    Decl::ImportSpec(spec) if hir[spec].imported_pos != hir[spec].pos => {
                        Some(hir[spec].imported_pos)
                    }
                    Decl::ExportSpec(spec) if hir[spec].local_pos != hir[spec].pos => {
                        Some(hir[spec].local_pos)
                    }
                    _ => None,
                };
                if let Some(start) = property_name
                    && let Some(target) = files.alias_target(symbol)
                {
                    let end = self.c.end_of_name_at(file, start);
                    self.write(start, end, scope, Found::Symbol(files.canonical(target)));
                }
            }
        }
    }

    /// `enclosing_scope_of_declaration`, and the same of the declarations that have no value meaning.
    fn enclosing_scope_of_declaration_name(&self, decl: Decl) -> ScopeId {
        let bound = self.c.bound(self.file);
        match decl {
            Decl::Interface(interface) => bound
                .scopes
                .iter()
                .position(|scope| scope.kind == ScopeKind::Interface(interface))
                .map_or(ScopeId::NONE, |index| ScopeId(index as u32)),
            Decl::TypeParam(parameter) => bound.type_param_scope[parameter.idx()],
            _ => self.c.enclosing_scope_of_declaration(self.file, decl),
        }
    }

    /// Where the name of `decl`, which is in the file that is written, starts.
    fn name_start_of_declaration(&self, decl: Decl) -> Option<u32> {
        let hir = self.c.hir(self.file);
        let (name, start) = match decl {
            Decl::Fn(function) if matches!(hir[function].kind, FnKind::Decl | FnKind::Expr) => {
                (hir[function].name, hir[function].name_pos)
            }
            Decl::Class(class) => (hir[class].name, hir[class].name_pos),
            Decl::Interface(interface) => (hir[interface].name, hir[interface].name_pos),
            Decl::Alias(alias) => (hir[alias].name, hir[alias].name_pos),
            Decl::Enum(enumeration) => (hir[enumeration].name, hir[enumeration].name_pos),
            Decl::EnumMember(member) => return Some(hir[member].pos),
            Decl::Module(module) => return Some(hir[module].name_pos),
            Decl::TypeParam(parameter) => (hir[parameter].name, hir[parameter].pos),
            Decl::ImportDefault(import) => (hir[import].default, hir[import].default_pos),
            Decl::ImportNamespace(import) => (hir[import].namespace, hir[import].namespace_pos),
            Decl::ImportSpec(spec) => (hir[spec].local, hir[spec].pos),
            Decl::ImportEquals(import) => (hir[import].name, hir[import].name_pos),
            Decl::ExportSpec(spec) => (hir[spec].exported, hir[spec].pos),
            Decl::ExportStarAs(_) | Decl::UmdGlobal(_) => {
                return self.c.declaration_name_start(self.file, decl);
            }
            _ => return None,
        };
        (name.is_some() && name != known::empty).then_some(start)
    }

    /// The names of the members of classes, interfaces and type literals.
    fn write_member_names(&mut self) {
        let file = self.file;
        let hir = self.c.hir(file);
        for index in 0..hir.members.len() {
            let member = MemberId(index as u32);
            if !is_named_member(hir[member].kind) || matches!(hir[member].key, PropKey::None) {
                continue;
            }
            let name = self.c.declared_member_name(file, hir[member].key);
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, member);
            let end = self.c.end_of_name_at(file, start);
            let scope = self.c.enclosing_scope_of_member(file, member);
            let found = Found::Property(Prop {
                name: name.unwrap_or(Atom::NONE),
                flags: PropFlags::empty(),
                source: PropSource::Members(vec![(file, member)].into()),
                mapper: MapperId::IDENTITY,
            });
            if matches!(hir[member].key, PropKey::Name(_)) {
                self.write_literal_in_computed_name(start, scope, found.clone());
            }
            self.write(start, end, scope, found);
        }
    }

    /// The names of the properties of object literals and of JSX attributes.
    fn write_property_names(&mut self) {
        let file = self.file;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        // An `ImportAttribute` is no declaration.
        let import_attributes: Vec<ExprId> = hir
            .import_attributes
            .iter()
            .map(|attributes| attributes.1)
            .collect();
        for index in 0..hir.props.len() {
            let property = PropId(index as u32);
            let written = hir[property];
            if matches!(written.kind, PropKind::Spread)
                || matches!(written.key, PropKey::None)
                || import_attributes.contains(&bound.prop_owner[index])
            {
                continue;
            }
            let end = self.c.end_of_prop_name(file, property);
            let scope = self.c.enclosing_scope_of_property(file, property);
            let found = Found::Property(Prop {
                name: written.key.name().unwrap_or(Atom::NONE),
                flags: PropFlags::empty(),
                source: PropSource::Literal(file, property),
                mapper: MapperId::IDENTITY,
            });
            if matches!(written.key, PropKey::Name(_)) {
                self.write_literal_in_computed_name(written.pos, scope, found.clone());
            }
            self.write(written.pos, end, scope, found);
        }
    }

    /// `IsLiteralComputedPropertyDeclarationName`: the literal in `["name"]` and `[0]`, which starts at `start`, has the symbol of
    /// the declaration.
    fn write_literal_in_computed_name(&mut self, start: u32, scope: ScopeId, found: Found) {
        let file = self.file;
        let text = &self.c.hir(file).text;
        if text.get(start as usize) != Some(&b'[') {
            return;
        }
        let literal = self.c.skip_trivia_from(file, start + 1);
        if text
            .get(literal as usize)
            .is_some_and(|&first| matches!(first, b'"' | b'\'') || first.is_ascii_digit())
        {
            let end = self.c.end_of_name_at(file, literal);
            self.write(literal, end, scope, found);
        }
    }

    /// The names that variables, parameters and binding elements declare, the property names in object binding patterns, and `this`
    /// parameters.
    fn write_binding_names(&mut self) {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        for index in 0..hir.pats.len() {
            let PatKind::Ident(name) = hir.pats[index].kind else {
                continue;
            };
            let start = hir.pats[index].pos;
            let end = self.c.end_of_name_at(file, start);
            let scope = self.c.enclosing_scope_of_pat(file, PatId(index as u32));
            // `bindParameter` declares the property last, so that is the symbol of the node.
            if let PatParent::Param(parameter) = bound.pat_parent[index]
                && hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
            {
                self.write(
                    start,
                    end,
                    scope,
                    Found::Property(Prop {
                        name,
                        flags: PropFlags::empty(),
                        source: PropSource::Parameter(file, parameter),
                        mapper: MapperId::IDENTITY,
                    }),
                );
                continue;
            }
            let symbol = bound.pat_symbol[index];
            if symbol.is_some() {
                self.write(start, end, scope, Found::Symbol(files.sym(file, symbol)));
            }
        }
        // `{ name: local }`: the property of the type of the pattern.
        for index in 0..hir.pat_props.len() {
            let element = hir.pat_props[index];
            let PropKey::Name(name) = element.key else {
                continue;
            };
            // `{ ["name"]: local }`: the binding element is the declaration.
            if element.value.is_some()
                && matches!(hir[element.value].kind, PatKind::Ident(_))
                && bound.pat_symbol[element.value.idx()].is_some()
            {
                let local = files.sym(file, bound.pat_symbol[element.value.idx()]);
                let scope = self.c.enclosing_scope_of_pat(file, element.value);
                self.write_literal_in_computed_name(element.pos, scope, Found::Symbol(local));
            }
            if element.is_rest
                || element.value.is_none()
                || element.pos == hir[element.value].pos
                || !hir
                    .text
                    .get(element.pos as usize)
                    .is_some_and(|&first| is_identifier_part(first) && !first.is_ascii_digit())
            {
                continue;
            }
            let PatParent::Prop(pattern, _) = bound.pat_parent[element.value.idx()] else {
                continue;
            };
            let ty = self.c.type_of_pat(file, pattern);
            if let Some(found) = self.get_property_of_type(ty, name) {
                let end = self.c.end_of_name_at(file, element.pos);
                let scope = self.c.enclosing_scope_of_pat(file, element.value);
                self.write(element.pos, end, scope, found);
            }
        }
        for index in 0..hir.fns.len() {
            let function = FnId(index as u32);
            if let Some(start) = self.this_parameter_start(file, function) {
                let scope = bound.fns[index].scope;
                self.write(start, start + 4, scope, this_parameter(file, function));
            }
        }
    }

    /// Where the name of the `this` parameter of `function` is written.
    fn this_parameter_start(&self, file: FileId, function: FnId) -> Option<u32> {
        let hir = self.c.hir(file);
        let declared = &hir[function];
        if declared.this_ty.is_none() || hir.text.get(declared.anchor as usize) != Some(&b'(') {
            return None;
        }
        let start = self.c.skip_trivia_from(file, declared.anchor + 1);
        hir.text
            .get(start as usize..start as usize + 4)
            .is_some_and(|word| word == b"this")
            .then_some(start)
    }

    fn write_expressions(&mut self) {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            // Not bound.
            if matches!(bound.expr_parent[index], Parent::None) {
                continue;
            }
            match hir[e].kind {
                ExprKind::Ident(name) => {
                    if let Some(found) = self.get_symbol_of_identifier(e, name) {
                        self.write_expression(e, e, found);
                    }
                }
                ExprKind::Dot {
                    obj,
                    name,
                    name_pos,
                    ..
                } => {
                    let found = if self.is_commonjs_module_exports(e, obj) {
                        Some(Found::Anonymous {
                            name: "exports".to_owned(),
                            file,
                            declaration: Declaration::Bound(Decl::File),
                        })
                    } else {
                        let ty = self.c.type_of_expr(file, obj);
                        match self.get_property_of_type(ty, name) {
                            Some(found) => Some(found),
                            None if self.c.is_private_name(name) => None,
                            None => {
                                let ty = self.c.apparent_type(ty);
                                self.get_applicable_index_symbol(ty, name)
                            }
                        }
                    };
                    // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the symbol of the whole access.
                    if let Some(found) = found {
                        let end = self.c.end_of_name_at(file, name_pos);
                        let scope = self.c.enclosing_scope_of_expr(file, e);
                        self.write(name_pos, end, scope, found.clone());
                        self.write_expression(e, e, found);
                    }
                }
                // `a["name"]`, `a[0]`
                ExprKind::Index { obj, index, .. } => {
                    let name = match hir[index].kind {
                        _ if self.c.is_written_in_parentheses(file, index) => continue,
                        ExprKind::String(text) => text,
                        ExprKind::Number(number) => {
                            self.c.number_name(hir.numbers[number as usize])
                        }
                        ExprKind::Template { exprs, texts } if exprs.is_empty() => {
                            match hir.ids(texts).next() {
                                Some(text) => text,
                                None => continue,
                            }
                        }
                        _ => continue,
                    };
                    let ty = self.c.type_of_expr(file, obj);
                    if let Some(found) = self.get_property_of_type(ty, name) {
                        self.write_expression(index, e, found);
                    }
                }
                ExprKind::This => {
                    let found = match self.c.this_container(file, e) {
                        Some(Ok(function))
                            if self.this_parameter_start(file, function).is_some() =>
                        {
                            Some(this_parameter(file, function))
                        }
                        _ => {
                            let ty = self.c.type_of_expr(file, e);
                            self.symbol_of_type(ty)
                        }
                    };
                    if let Some(found) = found {
                        self.write_expression(e, e, found);
                    }
                }
                ExprKind::Super => {
                    let ty = self.c.type_of_expr(file, e);
                    if let Some(found) = self.symbol_of_type(ty) {
                        self.write_expression(e, e, found);
                    }
                }
                // `checkExpression(node).symbol`. The `target` of `new.target` has the same symbol, the `meta` of `import.meta` is the
                // member of `getGlobalImportMetaExpressionType`.
                ExprKind::ImportMeta | ExprKind::NewTarget => {
                    let ty = self.c.type_of_expr(file, e);
                    let of_type = self.symbol_of_type(ty);
                    let (name_length, of_name) = if matches!(hir[e].kind, ExprKind::ImportMeta) {
                        let member = "ImportMetaExpression.meta".to_owned();
                        (4, Some(Found::Undeclared(member)))
                    } else {
                        (6, of_type.clone())
                    };
                    let end = self.c.end_inside_parentheses(file, e);
                    if end > name_length
                        && let Some(found) = of_name
                    {
                        let scope = self.c.enclosing_scope_of_expr(file, e);
                        self.write(end - name_length, end, scope, found);
                    }
                    if let Some(found) = of_type {
                        self.write_expression(e, e, found);
                    }
                }
                // `resolveExternalModuleName`
                ExprKind::ImportCall(specifier) if specifier.is_some() => {
                    if let ExprKind::String(text) = hir[specifier].kind
                        && let Some(module) = files.module_of_specifier_as(
                            file,
                            text,
                            files.mode_of_import_call(file),
                        )
                    {
                        self.write_expression(specifier, e, Found::Symbol(module));
                    }
                }
                // `IsVariableDeclarationInitializedToRequire`
                ExprKind::Call(_)
                    if hir.is_js && matches!(bound.expr_parent[index], Parent::VarInit(_)) =>
                {
                    if let Some(argument) = crate::bind::require_argument(hir, e)
                        && let ExprKind::String(text) = hir[argument].kind
                        && let Some(module) =
                            files.module_of_specifier_as(file, text, ResolutionMode::Require)
                    {
                        self.write_expression(argument, e, Found::Symbol(module));
                    }
                }
                // The `const` of `x as const` and `<const>x` is a type reference that resolves to nothing.
                ExprKind::AsConst(operand) => {
                    let start = if hir[e].pos < hir[operand].pos {
                        self.c.skip_trivia_from(file, hir[e].pos + 1)
                    } else {
                        let keyword = self
                            .c
                            .skip_trivia_from(file, self.c.end_of_expr(file, operand));
                        self.c.skip_trivia_from(file, keyword + 2)
                    };
                    if hir
                        .text
                        .get(start as usize..start as usize + 5)
                        .is_some_and(|word| word == b"const")
                    {
                        let unresolved = Found::Undeclared("const".to_owned());
                        self.write(start, start + 5, ScopeId::NONE, unresolved);
                    }
                }
                _ => {}
            }
        }
    }

    /// Writes `found` for the expression `e`. `within`: `e`, or the expression it is an operand of, which is in the same scope.
    fn write_expression(&mut self, e: ExprId, within: ExprId, found: Found) {
        let start = self.c.start_inside_parentheses(self.file, e);
        let end = self.c.end_inside_parentheses(self.file, e);
        let scope = self.c.enclosing_scope_of_expr(self.file, within);
        self.write(start, end, scope, found);
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

    /// `getIntrinsicTagSymbol`, of the names in the opening and closing tags.
    fn write_jsx_intrinsic_tag_names(&mut self) {
        let file = self.file;
        let hir = self.c.hir(file);
        for index in 0..hir.jsx.len() {
            let element = hir.jsx[index];
            let mut tags: Vec<(Atom, u32)> = Vec::new();
            for tag in [element.tag, element.close_tag] {
                if tag.is_some()
                    && let ExprKind::String(name) = hir[tag].kind
                {
                    tags.push((name, hir[tag].pos));
                }
            }
            // `</name>` that repeats the opening name is not kept in the tree.
            if element.close_tag.is_none()
                && element.close_pos != u32::MAX
                && let Some(&(name, _)) = tags.first()
            {
                let slash = self.c.skip_trivia_from(file, element.close_pos + 1);
                if hir.text.get(slash as usize) == Some(&b'/') {
                    tags.push((name, self.c.skip_trivia_from(file, slash + 1)));
                }
            }
            if tags.is_empty() {
                continue;
            }
            let Some(elements) = self.c.jsx_type(file, known::IntrinsicElements) else {
                continue;
            };
            let within = if element.tag.is_some() {
                element.tag
            } else {
                element.close_tag
            };
            let scope = self.c.enclosing_scope_of_expr(file, within);
            for (name, start) in tags {
                let written = self.c.files().atoms.bytes(name);
                let end = start as usize + written.len();
                // A `JsxNamespacedName` is no identifier.
                if written.contains(&b':') || hir.text.get(start as usize..end) != Some(written) {
                    continue;
                }
                let found = match self.c.prop_of(elements, name) {
                    Some((prop, _)) => Some(Found::Property(prop)),
                    None => self.get_applicable_index_symbol(elements, name),
                };
                if let Some(found) = found {
                    self.write(start, end as u32, scope, found);
                }
            }
        }
    }

    /// The identifiers in type references and type predicates. The operand of `typeof` is an expression.
    fn write_type_nodes(&mut self) {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        // `IsNameOfHeritageClauseTypeReference`
        let mut heritage: FxHashSet<TypeNodeId> = FxHashSet::default();
        for class in &hir.classes {
            heritage.extend(hir.ids(class.implements));
        }
        for interface in &hir.interfaces {
            heritage.extend(hir.ids(interface.extends));
        }
        for index in 0..hir.types.len() {
            let scope = bound.type_scope[index];
            if scope.is_none() {
                continue;
            }
            let start = hir.types[index].pos;
            match hir.types[index].kind {
                TypeNodeKind::Ref { name, .. } => {
                    let names: Vec<Atom> = hir.ids(name).collect();
                    let is_heritage = heritage.contains(&TypeNodeId(index as u32));
                    let ranges = self.entity_name_ranges(start, &names);
                    for (last, &(from, to)) in ranges.iter().enumerate() {
                        let meaning = if last + 1 == names.len() {
                            SymFlags::TYPE
                        } else {
                            SymFlags::NAMESPACE
                        };
                        let resolved = files.resolve_entity(file, scope, &names[..=last], meaning);
                        if resolved.is_none() && is_heritage {
                            continue;
                        }
                        // `getUnresolvedSymbolForEntityName`
                        let unresolved = || {
                            let path: Vec<String> = names[..=last]
                                .iter()
                                .map(|&part| files.atoms.text(part).into_owned())
                                .collect();
                            Found::Undeclared(path.join("."))
                        };
                        let found = resolved.map_or_else(unresolved, Found::Symbol);
                        self.write(from, to, scope, found.clone());
                        // The qualified names of a heritage clause are written too.
                        if is_heritage && last > 0 {
                            self.write(ranges[0].0, to, scope, found);
                        }
                    }
                }
                // `getTypeFromImportTypeNode`: the identifiers of the qualifier.
                TypeNodeKind::Import {
                    spec,
                    name,
                    is_typeof,
                    mode,
                    ..
                } if !name.is_empty() => {
                    let names: Vec<Atom> = hir.ids(name).collect();
                    let Some(qualifier) = self.import_type_qualifier_start(start) else {
                        continue;
                    };
                    let mode = files.mode_of_import(file, mode);
                    let Some(module) = files.module_of_specifier_as(file, spec, mode) else {
                        continue;
                    };
                    let mut namespace = files.module_value(module);
                    let ranges = self.entity_name_ranges(qualifier, &names);
                    for (index, &(from, to)) in ranges.iter().enumerate() {
                        let meaning = if index + 1 < names.len() {
                            SymFlags::NAMESPACE
                        } else if is_typeof {
                            SymFlags::VALUE
                        } else {
                            SymFlags::TYPE
                        };
                        let Some(next) = files
                            .resolve_alias_if_needed(namespace)
                            .and_then(|container| files.namespace_member(container, names[index]))
                            .filter(|&next| files.means(next, meaning))
                        else {
                            break;
                        };
                        self.write(from, to, scope, Found::Symbol(next));
                        namespace = next;
                    }
                }
                TypeNodeKind::Predicate { param, asserts, .. } if param != known::this => {
                    let mut from = start;
                    if asserts
                        && hir
                            .text
                            .get(from as usize..from as usize + 7)
                            .is_some_and(|word| word == b"asserts")
                    {
                        from = self.c.skip_trivia_from(file, from + 7);
                    }
                    if let [(from, to)] = self.entity_name_ranges(from, &[param])[..]
                        && let Some(parameter) = files.resolve_name(
                            file,
                            scope,
                            param,
                            SymFlags::FUNCTION_SCOPED_VARIABLE,
                        )
                    {
                        self.write(from, to, scope, Found::Symbol(parameter));
                    }
                }
                _ => {}
            }
        }
    }

    /// Where the qualifier of `import("m").A.B` or `typeof import("m").a`, which starts at `start`, starts.
    fn import_type_qualifier_start(&self, start: u32) -> Option<u32> {
        let file = self.file;
        let text = &self.c.hir(file).text[..];
        let mut at = start;
        if text.get(at as usize..)?.starts_with(b"typeof") {
            at = self.c.skip_trivia_from(file, at + 6);
        }
        if !text.get(at as usize..)?.starts_with(b"import") {
            return None;
        }
        let open = self.c.skip_trivia_from(file, at + 6);
        if text.get(open as usize) != Some(&b'(') {
            return None;
        }
        let dot = self
            .c
            .skip_trivia_from(file, self.c.end_of_bracket_at(file, open));
        (text.get(dot as usize) == Some(&b'.')).then(|| self.c.skip_trivia_from(file, dot + 1))
    }

    /// `getSymbolOfPartOfRightHandSideOfImportEquals`, of each identifier in `import a = b.c.d`.
    fn write_import_equals_references(&mut self) {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        for index in 0..hir.import_equals.len() {
            let import = hir.import_equals[index];
            let ImportEqualsTarget::Entity(list) = import.target else {
                continue;
            };
            let names: Vec<Atom> = hir.ids(list).collect();
            let after_name = self.c.end_of_name_at(file, import.name_pos);
            let equals = self.c.skip_trivia_from(file, after_name);
            if hir.text.get(equals as usize) != Some(&b'=') {
                continue;
            }
            let start = self.c.skip_trivia_from(file, equals + 1);
            let ranges = self.entity_name_ranges(start, &names);
            for (last, &(from, to)) in ranges.iter().enumerate() {
                let meaning = if last > 0 && last + 1 == names.len() {
                    SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
                } else {
                    SymFlags::NAMESPACE
                };
                let scope = bound.import_equals_scope[index];
                if let Some(symbol) = files.resolve_entity(file, scope, &names[..=last], meaning) {
                    self.write(from, to, scope, Found::Symbol(symbol));
                }
            }
        }
    }

    /// Where the identifiers of `a.b.c`, which starts at `start`, are written. It stops at the first that is not written as `names`
    /// has it.
    fn entity_name_ranges(&self, start: u32, names: &[Atom]) -> Vec<(u32, u32)> {
        let text = &self.c.hir(self.file).text[..];
        let atoms = &self.c.files().atoms;
        let mut ranges = Vec::with_capacity(names.len());
        let mut at = start;
        for (index, &name) in names.iter().enumerate() {
            let end = at as usize + atoms.bytes(name).len();
            if text.get(at as usize..end) != Some(atoms.bytes(name))
                || text.get(end).is_some_and(|&next| is_identifier_part(next))
            {
                break;
            }
            ranges.push((at, end as u32));
            if index + 1 == names.len() {
                break;
            }
            let dot = self.c.skip_trivia_from(self.file, end as u32);
            if text.get(dot as usize) != Some(&b'.') {
                break;
            }
            at = self.c.skip_trivia_from(self.file, dot + 1);
        }
        ranges
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
            && !self.c.is_written_in_parentheses(file, e)
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

    /// `getPropertyOfType`, of the type of the left side of an access.
    fn get_property_of_type(&mut self, ty: TypeId, name: Atom) -> Option<Found> {
        let ty = self.c.non_nullable(ty);
        let ty = self.c.apparent_type(ty);
        let TypeData::Union(parts) = self.c.data(ty) else {
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
        };
        // `createUnionOrIntersectionProperty`
        let mut prop_set: Vec<(Prop, MapperId)> = Vec::new();
        for &part in parts.iter() {
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

    /// `getApplicableIndexSymbol`, for the key `name`. Signatures for `string` and `number` only.
    fn get_applicable_index_symbol(&mut self, ty: TypeId, name: Atom) -> Option<Found> {
        let members = self.c.members(ty)?;
        self.c
            .applicable_index_info(&members, TypeId::STRING, Some(name))?;
        let (parent, is_static) = match *self.c.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) => (target, false),
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => (class, true),
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node),
                ..
            } => {
                let TypeNodeKind::Object(list) = self.c.hir(file)[node].kind else {
                    return None;
                };
                let (file, member) = self.index_signature_among(&[(file, list)], name, false)?;
                return Some(Found::IndexSignature {
                    parent: None,
                    file,
                    member,
                });
            }
            _ => return None,
        };
        let (file, member) = self.index_signature_of(parent, name, is_static, 0)?;
        Some(Found::IndexSignature {
            parent: Some(parent),
            file,
            member,
        })
    }

    /// `info.declaration`: the index signature of the class or interface `container`, or of what it extends, that applies to `name`.
    fn index_signature_of(
        &mut self,
        container: Sym,
        name: Atom,
        is_static: bool,
        depth: u32,
    ) -> Option<(FileId, MemberId)> {
        let lists = self.member_lists_of(container);
        if let Some(found) = self.index_signature_among(&lists, name, is_static) {
            return Some(found);
        }
        if is_static || depth > 8 {
            return None;
        }
        for &base in self.c.base_types(container).iter() {
            if let TypeData::Ref { target, .. } = *self.c.data(base)
                && let Some(found) = self.index_signature_of(target, name, false, depth + 1)
            {
                return Some(found);
            }
        }
        None
    }

    /// `findApplicableIndexInfo`: the signature for `string` counts only where that for `number` does not apply.
    fn index_signature_among(
        &self,
        lists: &[(FileId, Span<MemberId>)],
        name: Atom,
        is_static: bool,
    ) -> Option<(FileId, MemberId)> {
        let is_numeric = self.c.is_numeric_name(name);
        let mut by_string = None;
        for &(file, members) in lists {
            let hir = self.c.hir(file);
            for member in members.iter() {
                let written = hir[member];
                if written.kind != MemberKind::IndexSignature
                    || written.func.is_none()
                    || self.is_static_member(file, member) != is_static
                {
                    continue;
                }
                let parameters = hir[written.func].params;
                if parameters.len() != 1 || hir[parameters.at(0)].ty.is_none() {
                    continue;
                }
                match hir[hir[parameters.at(0)].ty].kind {
                    TypeNodeKind::Keyword(Keyword::Number) if is_numeric => {
                        return Some((file, member));
                    }
                    TypeNodeKind::Keyword(Keyword::String) if by_string.is_none() => {
                        by_string = Some((file, member));
                    }
                    _ => {}
                }
            }
        }
        by_string
    }

    /// The members of each declaration of the class or interface `container`.
    fn member_lists_of(&self, container: Sym) -> Vec<(FileId, Span<MemberId>)> {
        self.c
            .files()
            .decls(container)
            .into_iter()
            .filter(|&(file, decl)| self.is_declaration_of_symbol(container, file, decl))
            .filter_map(|(file, decl)| match decl {
                Decl::Class(class) => Some((file, self.c.hir(file)[class].members)),
                Decl::Interface(interface) => Some((file, self.c.hir(file)[interface].members)),
                _ => None,
            })
            .collect()
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
            && !self.c.is_written_in_parentheses(file, e)
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

    fn declarations_of_symbol(&self, symbol: Sym) -> Vec<(FileId, Declaration)> {
        let decls = self.c.files().decls(symbol);
        if let [(file, Decl::TypeParam(parameter))] = decls[..]
            && let Some(merged) = self.declarations_of_type_parameter(file, parameter)
        {
            return merged;
        }
        decls
            .into_iter()
            .filter(|&(file, decl)| self.is_declaration_of_symbol(symbol, file, decl))
            .map(|(file, decl)| (file, Declaration::Bound(decl)))
            .collect()
    }

    /// The type parameters of a class or an interface are declared among its members, so those of one name are one symbol over all
    /// its declarations. The binder has a symbol for each. `None`: `parameter` is declared by something else.
    fn declarations_of_type_parameter(
        &self,
        file: FileId,
        parameter: TypeParamId,
    ) -> Option<Vec<(FileId, Declaration)>> {
        let files = self.c.files();
        let bound = self.c.bound(file);
        let scope = bound.type_param_scope[parameter.idx()];
        if scope.is_none() {
            return None;
        }
        let container = match bound.scopes[scope.idx()].kind {
            ScopeKind::Class(class) => bound.class_symbol[class.idx()],
            ScopeKind::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => return None,
        };
        if container.is_none() {
            return None;
        }
        let container = files.sym(file, container);
        let name = self.c.hir(file)[parameter].name;
        let mut declarations = Vec::new();
        for (file, decl) in files.decls(container) {
            if !self.is_declaration_of_symbol(container, file, decl) {
                continue;
            }
            let hir = self.c.hir(file);
            let parameters = match decl {
                Decl::Class(class) => hir[class].type_params,
                Decl::Interface(interface) => hir[interface].type_params,
                _ => continue,
            };
            for candidate in parameters.iter() {
                if hir[candidate].name == name {
                    declarations.push((file, Declaration::Bound(Decl::TypeParam(candidate))));
                }
            }
        }
        Some(declarations)
    }

    fn declarations_of_property(&mut self, prop: &Prop, depth: u32) -> Vec<(FileId, Declaration)> {
        match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, member)) => self.declarations_in_container(
                    file,
                    member,
                    prop.name,
                    Declaration::Member(member),
                ),
                None => Vec::new(),
            },
            PropSource::Parameter(file, parameter) => {
                let bound = self.c.bound(*file);
                let declaration = Declaration::Parameter(*parameter);
                let function = bound.param_fn[parameter.idx()];
                match bound.fns.get(function.idx()).map(|function| function.owner) {
                    Some(FnOwner::Member(constructor)) => {
                        self.declarations_in_container(*file, constructor, prop.name, declaration)
                    }
                    _ => vec![(*file, declaration)],
                }
            }
            PropSource::Literal(file, property) => {
                self.declarations_of_literal_property(*file, *property)
            }
            PropSource::Symbol(symbol) => self.declarations_of_symbol(*symbol),
            PropSource::Assigned(file, assignments) => assignments
                .iter()
                .map(|&assignment| (*file, Declaration::Expression(assignment)))
                .collect(),
            // Overloads of which only the signatures are kept.
            PropSource::Type(_) => match self.c.first_declaration_of_overloads(prop) {
                Some((file, member)) => self.declarations_in_container(
                    file,
                    member,
                    prop.name,
                    Declaration::Member(member),
                ),
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

    /// The declarations of the symbol that `target` is a declaration of. `target` is `member`, or a parameter property of the
    /// constructor `member`. `declareSymbolEx` puts the members of one name together, over all the declarations of the class or
    /// interface, unless what has the name excludes them.
    fn declarations_in_container(
        &mut self,
        file: FileId,
        member: MemberId,
        name: Atom,
        target: Declaration,
    ) -> Vec<(FileId, Declaration)> {
        let alone = vec![(file, target)];
        // `InternalSymbolNameComputed`
        if name.is_none() {
            return alone;
        }
        let hir = self.c.hir(file);
        let wants_static =
            matches!(target, Declaration::Member(_)) && self.is_static_member(file, member);
        let lists: Vec<(FileId, Span<MemberId>)> =
            match self.c.bound(file).member_owner[member.idx()] {
                MemberOwner::TypeLiteral(node) => match hir[node].kind {
                    TypeNodeKind::Object(members) => vec![(file, members)],
                    _ => return alone,
                },
                MemberOwner::None => return alone,
                MemberOwner::Class(_) | MemberOwner::Interface(_) => {
                    let Some(container) = self.container_of_member(file, member) else {
                        return alone;
                    };
                    self.member_lists_of(container)
                }
            };
        let mut candidates: Vec<MemberDeclaration> = Vec::new();
        for (file, members) in lists {
            let hir = self.c.hir(file);
            for candidate in members.iter() {
                let written = hir[candidate];
                if written.kind == MemberKind::Constructor && !wants_static {
                    if written.func.is_none() {
                        continue;
                    }
                    for parameter in hir[written.func].params.iter() {
                        if hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
                            && hir[parameter].pat.is_some()
                            && matches!(hir[hir[parameter].pat].kind, PatKind::Ident(own) if own == name)
                        {
                            let declaration = Declaration::Parameter(parameter);
                            candidates.push((file, declaration, PROPERTY, METHOD));
                        }
                    }
                    continue;
                }
                if !is_named_member(written.kind)
                    || self.is_static_member(file, candidate) != wants_static
                {
                    continue;
                }
                let is_same_name = match written.key {
                    PropKey::Name(own) | PropKey::Private(own) => own == name,
                    PropKey::Computed(_) => {
                        self.c.declared_member_name(file, written.key) == Some(name)
                    }
                    PropKey::None => false,
                };
                if is_same_name {
                    // `SymbolFlagsMethodExcludes`, `SymbolFlagsGetAccessorExcludes`, `SymbolFlagsSetAccessorExcludes`,
                    // `SymbolFlagsAccessorExcludes` (`bindPropertyWorker`), `SymbolFlagsPropertyExcludes`
                    let (includes, excludes) = match written.kind {
                        MemberKind::Method => (METHOD, PROPERTY | ACCESSOR),
                        MemberKind::Getter => (GET_ACCESSOR, GET_ACCESSOR | METHOD),
                        MemberKind::Setter => (SET_ACCESSOR, SET_ACCESSOR | METHOD),
                        _ if written.flags.contains(Flags::ACCESSOR) => {
                            (ACCESSOR, ACCESSOR | METHOD)
                        }
                        _ => (PROPERTY, METHOD),
                    };
                    let declaration = Declaration::Member(candidate);
                    candidates.push((file, declaration, includes, excludes));
                }
            }
        }
        declarations_of_same_symbol(&candidates, (file, target))
    }

    /// `declareClassMember`: only a class has a static side.
    fn is_static_member(&self, file: FileId, member: MemberId) -> bool {
        self.c.hir(file)[member].flags.contains(Flags::STATIC)
            && matches!(
                self.c.bound(file).member_owner[member.idx()],
                MemberOwner::Class(_)
            )
    }

    /// The same for a property of an object literal or a JSX attribute.
    fn declarations_of_literal_property(
        &self,
        file: FileId,
        property: PropId,
    ) -> Vec<(FileId, Declaration)> {
        self.c
            .bound(file)
            .declarations_of_literal_member(property)
            .into_iter()
            .map(|declaration| (file, Declaration::Property(declaration)))
            .collect()
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
            PropSource::Intersected(_, parts) => return self.describe_properties(parts, at),
            _ => {}
        }
        let declarations = self.declarations_of_property(prop, 0);
        let name = self.c.prop_to_string(prop);
        let parent = self.parent_of_property(prop);
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
        push_access(&mut text, &name);
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
                push_access(&mut text, &name);
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
        let parent = files.symbol(symbol).parent;
        let is_default_export = parent.is_some()
            && files.export(files.sym(symbol.file, parent), known::default) == Some(symbol);
        // `isDefaultBindingContext`, as far as files go.
        if is_default_export && (!is_initial || symbol.file != self.file) {
            return "default".to_owned();
        }
        if self.is_external_module(symbol) {
            let specifier = self.c.specifier_for_module_symbol_at(symbol, self.file, at);
            return format!("\"{specifier}\"");
        }
        self.c.symbol_to_string(symbol)
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    fn is_external_module(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        files
            .decls(symbol)
            .into_iter()
            .any(|(file, decl)| match decl {
                Decl::File => files.module(file).is_module(),
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

/// A member that `declareSymbolEx` enters in a table under its name.
fn is_named_member(kind: MemberKind) -> bool {
    matches!(
        kind,
        MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
    )
}

/// `declareSymbolEx`, over the declarations of one name in one table, in the order they are bound: those of the symbol that `target`
/// is a declaration of. A declaration that what is in the table excludes gets a symbol of its own, which is in no table.
fn declarations_of_same_symbol(
    candidates: &[MemberDeclaration],
    target: (FileId, Declaration),
) -> Vec<(FileId, Declaration)> {
    let mut in_table = Vec::new();
    let mut flags = 0u8;
    for &(file, declaration, includes, excludes) in candidates {
        if flags & excludes != 0 {
            // An accessor that conflicts with anything but an accessor of its kind makes the symbol a full accessor.
            if flags & ACCESSOR != 0 && flags & ACCESSOR != includes & ACCESSOR {
                flags |= ACCESSOR;
            }
            if (file, declaration) == target {
                return vec![target];
            }
            continue;
        }
        flags |= includes;
        in_table.push((file, declaration));
    }
    if in_table.contains(&target) {
        in_table
    } else {
        vec![target]
    }
}

/// `createExpressionFromSymbolChain`, past the first symbol: `.name`, or `[name]` for what is no identifier. The brackets of a
/// computed name are not doubled.
fn push_access(text: &mut String, name: &str) {
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
    let inner = name
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(name);
    text.push('[');
    text.push_str(inner);
    text.push(']');
}

/// Every character that is not ASCII counts as part of a name.
fn is_identifier_part(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$') || c >= 0x80
}

/// How many UTF-16 code units the character takes whose UTF-8 encoding `byte` is a byte of, counted at its first byte.
fn utf16_length(byte: u8) -> usize {
    match byte {
        0x80..=0xBF => 0,
        0xF0..=0xFF => 2,
        _ => 1,
    }
}

/// `ComputeECMALineStarts`
fn compute_ecma_line_starts(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0u32];
    let mut at = 0;
    while at < text.len() {
        match text[at] {
            b'\r' => {
                at += if text.get(at + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                starts.push(at as u32);
            }
            b'\n' => {
                at += 1;
                starts.push(at as u32);
            }
            0xE2 if text.get(at + 1) == Some(&0x80)
                && matches!(text.get(at + 2), Some(0xA8 | 0xA9)) =>
            {
                at += 3;
                starts.push(at as u32);
            }
            _ => at += 1,
        }
    }
    starts
}
