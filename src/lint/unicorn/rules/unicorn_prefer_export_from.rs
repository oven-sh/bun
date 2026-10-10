use bun_lint_oxlint::text::find_next_token_within;
use crate::unicorn::concat;
use bstr::ByteSlice;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Prefer direct re-exports using `export ... from` syntax instead of separate import and export statements.
pub struct PreferExportFrom {
    check_used_variables: bool,
}

const PREFER_EXPORT_FROM: Message = Message::new("", "Prefer re-exporting directly from the source module.");
const USE_EXPORT_FROM: Message = Message::new("", "use `export ... from ...;`");

#[derive(Default)]
pub struct State<'a> {
    /// Whether the file exports anything in a way that the rule is about.
    has_candidates: Option<bool>,
    /// The `export { .. } from` of the file, by the module.
    exports_from: Option<FxHashMap<Name<'a>, SmallVec<[Export<'a>; 1]>>>,
}

impl Rule for PreferExportFrom {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-export-from", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        PreferExportFrom { check_used_variables: options.object(0).bool_or("checkUsedVariables", true) }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if let StmtKind::Import(import_decl) = statement.kind()
            && !import_decl.is_side_effect()
            && *cx.state.has_candidates.get_or_insert_with(|| has_candidates(file))
        {
            self.check_re_export(import_decl, cx);
        }
    }
}

/// Nothing is asked about variables in a file without one of these.
fn has_candidates<'a>(file: &'a File<'a>) -> bool {
    let is_identifier = |e: Expr| e.tag() == ExprTag::Ident;
    // What a namespace exports is not looked for.
    file.has_stmts([StmtTag::Module])
        || file.body().iter().any(|it| match it.kind() {
            StmtKind::ExportDefault(e) => is_identifier(e),
            StmtKind::ExportNamed(export) => !export.has_from() && !export.items().is_empty(),
            StmtKind::Var(declarations) => it.is_exported() && declarations.iter().filter_map(VarDecl::init).any(is_identifier),
            _ => false,
        })
}

#[derive(Copy, Clone)]
enum Specifier<'a> {
    Default(Ident<'a>),
    /// With the range of `* as a`.
    Namespace(Span),
    Named(ImportSpec<'a>),
}

struct SpecifierSpec<'a> {
    specifier: Specifier<'a>,
    symbol: Symbol<'a>,
    /// The local name.
    name: Name<'a>,
    /// Something else is done with it than to export it.
    is_locally_used: bool,
}

struct Violation<'a> {
    export_name: Vec<u8>,
    /// The statement that exports it.
    export_node: Stmt<'a>,
    is_namespace_export: bool,
    is_typescript_type: bool,
    needs_source: bool,
    /// Which of the specifiers of the import it is.
    specifier_index: usize,
    /// The name where it is exported.
    reference: Span,
}

/// What a reference to something imported is directly in.
enum Usage<'a> {
    /// `export default a`
    ExportDefaultDeclaration(Stmt<'a>),
    /// `export { a }`
    ExportSpecifier(ExportSpec<'a>),
    /// `b = a`, without a type
    VariableDeclarator(VarDecl<'a>),
    Other,
}

fn usage_of(reference: Reference<'_>) -> Usage<'_> {
    match reference.node() {
        Node::ExportSpec(export_specifier) => Usage::ExportSpecifier(export_specifier),
        Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
            Node::Stmt(statement) if statement.tag() == StmtTag::ExportDefault => Usage::ExportDefaultDeclaration(statement),
            Node::VarDecl(var_decl) if var_decl.init() == Some(e) && var_decl.ty().is_none() => Usage::VariableDeclarator(var_decl),
            _ => Usage::Other,
        },
        _ => Usage::Other,
    }
}

/// What oxlint has as the references to a symbol: not the name in a declaration with a value.
fn symbol_references(symbol: Symbol<'_>) -> impl Iterator<Item = Reference<'_>> {
    symbol.references().filter(|it| !it.is_jsx_pragma() && !matches!(it.node(), Node::Pat(_)))
}

/// The `export const ..` that `var_decl` is a part of.
fn exported_const_statement(var_decl: VarDecl<'_>) -> Option<Stmt<'_>> {
    let statement = Node::VarDecl(var_decl).parent().as_stmt()?;
    (var_decl.var_kind() == VarKind::Const && statement.is_exported()).then_some(statement)
}

/// As it is written if it is a string, with its quotes.
fn raw_name<'a>(file: &'a File<'a>, name: Ident<'a>) -> &'a [u8] {
    match name.is_string() {
        true => file.slice(name.span()),
        false => name.bytes(),
    }
}

/// `ModuleExportName::to_string`
fn display_name(name: Ident) -> Vec<u8> {
    match name.is_string() {
        true => concat(&[b"\"", name.bytes(), b"\""]),
        false => name.bytes().to_vec(),
    }
}

impl PreferExportFrom {
    fn check_re_export<'a>(&self, import_decl: Import<'a>, cx: &mut Cx<'a, Self>) {
        let statement = import_decl.stmt();
        let scope = Node::Stmt(statement).scope();
        let default = import_decl.default().map(|it| (Specifier::Default(it), it));
        let namespace = import_decl.namespace().zip(import_decl.namespace_span()).map(|(it, span)| (Specifier::Namespace(span), it));
        let named = import_decl.named().iter().map(|it| (Specifier::Named(it), it.local()));
        let mut specifiers: SmallVec<[SpecifierSpec<'a>; 8]> = (default.into_iter().chain(namespace).chain(named))
            .filter_map(|(specifier, local)| {
                Some(SpecifierSpec { specifier, symbol: scope.get_name(local.name())?, name: local.name(), is_locally_used: false })
            })
            .collect();
        // `import { A } from ..; type A = ..`
        let is_type_alias = |it: &SpecifierSpec| it.symbol.declarations().any(|it| matches!(it, Declaration::TypeAlias(_)));
        if !import_decl.is_type_only() && specifiers.iter().any(is_type_alias) {
            return;
        }
        if !self.check_used_variables && specifiers.iter().any(has_ignored_usage) {
            return;
        }
        let violations = analyze_import_usage(&mut specifiers, import_decl);
        if violations.is_empty() {
            return;
        }
        let re_export_decl = find_corresponding_export(import_decl, cx);
        let (namespace_violations, regular_violations): (Vec<_>, Vec<_>) = violations.into_iter().partition(|it| it.is_namespace_export);
        for (violations, is_namespace) in [(namespace_violations, true), (regular_violations, false)] {
            let group = Group { import_decl, specifiers: &specifiers, violations: &violations, re_export_decl, is_namespace };
            for violation in &violations {
                cx.report(statement, PREFER_EXPORT_FROM)
                    .first_label("Imported here.")
                    .label(violation.reference, "Re-exported here.")
                    .suggest(USE_EXPORT_FROM, |fixer| group.fix(fixer, violation));
            }
        }
    }
}

/// With `checkUsedVariables: false`: something else is done with it than what is reported.
fn has_ignored_usage(specifier_spec: &SpecifierSpec) -> bool {
    let is_namespace = matches!(specifier_spec.specifier, Specifier::Namespace(_));
    symbol_references(specifier_spec.symbol).any(|reference| match usage_of(reference) {
        Usage::ExportSpecifier(export_specifier) => is_namespace && export_specifier.exported().name().is("default"),
        Usage::ExportDefaultDeclaration(_) => is_namespace,
        Usage::VariableDeclarator(var_decl) => exported_const_statement(var_decl).is_none(),
        Usage::Other => true,
    })
}

fn analyze_import_usage<'a>(specifiers: &mut [SpecifierSpec<'a>], import_decl: Import<'a>) -> Vec<Violation<'a>> {
    let mut violations = Vec::new();
    // Whether the `export { .. }` that was looked at last has a `default`.
    let mut export_as_default: Option<(Export<'a>, bool)> = None;
    for (specifier_index, specifier_spec) in specifiers.iter_mut().enumerate() {
        let is_namespace = matches!(specifier_spec.specifier, Specifier::Namespace(_));
        for reference in symbol_references(specifier_spec.symbol) {
            let violation = match usage_of(reference) {
                Usage::ExportDefaultDeclaration(export_node) if !is_namespace => {
                    let is_type = import_decl.is_type_only() && matches!(specifier_spec.specifier, Specifier::Default(_));
                    let target_name = get_target_name_for_default_export(specifier_spec);
                    Some(Violation {
                        export_name: if is_type { concat(&[b"type ", &target_name]) } else { target_name },
                        export_node,
                        is_namespace_export: false,
                        is_typescript_type: false,
                        needs_source: false,
                        specifier_index,
                        reference: reference.span(),
                    })
                }
                Usage::ExportSpecifier(export_specifier) => {
                    let export_decl = export_specifier.export();
                    let is_export_default = is_namespace
                        && match export_as_default {
                            Some((known, is_export_default)) if known == export_decl => is_export_default,
                            _ => {
                                let is_default = |it: ExportSpec| !it.exported().is_string() && it.exported().name().is("default");
                                let is_export_default = export_decl.items().iter().any(is_default);
                                export_as_default = Some((export_decl, is_export_default));
                                is_export_default
                            }
                        };
                    let export_name = get_export_name(specifier_spec, export_specifier);
                    let is_type_import = import_decl.is_type_only()
                        || matches!(specifier_spec.specifier, Specifier::Named(import_specifier) if import_specifier.is_type_only());
                    (!is_export_default).then(|| Violation {
                        export_name: if is_namespace { concat(&[b"* as ", &export_name]) } else { export_name },
                        export_node: export_decl.stmt(),
                        is_namespace_export: is_namespace,
                        is_typescript_type: is_type_import || is_namespace && export_decl.is_type_only(),
                        needs_source: !is_type_import && export_decl.is_type_only(),
                        specifier_index,
                        reference: reference.span(),
                    })
                }
                Usage::VariableDeclarator(var_decl) => exported_const_statement(var_decl).and_then(|export_node| {
                    let target = var_decl.pat();
                    let target_name = target.as_ident()?;
                    if symbol_references(target.symbol()?).next().is_some() {
                        return None;
                    }
                    Some(Violation {
                        export_name: concat(&[get_export_name_for_export_decl(specifier_spec), b" as ", target_name.bytes()]),
                        export_node,
                        is_namespace_export: is_namespace,
                        is_typescript_type: false,
                        needs_source: false,
                        specifier_index,
                        reference: reference.span(),
                    })
                }),
                _ => None,
            };
            specifier_spec.is_locally_used |= violation.is_none();
            violations.extend(violation);
        }
    }
    violations
}

fn get_target_name_for_default_export(specifier_spec: &SpecifierSpec) -> Vec<u8> {
    match specifier_spec.specifier {
        Specifier::Named(import_specifier) => {
            let imported_name = raw_name(import_specifier.file(), import_specifier.imported());
            if imported_name == b"default" {
                b"default".to_vec()
            } else if strings::contains_char(imported_name, b'\'') {
                concat(&[imported_name, b" as default"])
            } else {
                concat(&[specifier_spec.name.bytes(), b" as default"])
            }
        }
        _ => b"default".to_vec(),
    }
}

fn get_export_name_for_export_decl<'a>(specifier_spec: &SpecifierSpec<'a>) -> &'a [u8] {
    match specifier_spec.specifier {
        Specifier::Default(_) => b"default",
        Specifier::Named(import_specifier) => raw_name(import_specifier.file(), import_specifier.imported()),
        Specifier::Namespace(_) => b"*",
    }
}

fn get_export_name<'a>(specifier_spec: &SpecifierSpec<'a>, export_specifier: ExportSpec<'a>) -> Vec<u8> {
    let exported = export_specifier.exported();
    match specifier_spec.specifier {
        Specifier::Default(_) => match display_name(exported) {
            temp_export if temp_export == b"default" => temp_export,
            temp_export => concat(&[b"default as ", &temp_export]),
        },
        Specifier::Named(import_specifier) => {
            let file = import_specifier.file();
            let (imported_name, temp_export) = (raw_name(file, import_specifier.imported()), raw_name(file, exported));
            if imported_name == b"default" {
                concat(&[b"default as ", temp_export])
            } else if temp_export == b"default" {
                concat(&[imported_name, b" as default"])
            } else if imported_name == temp_export {
                temp_export.to_vec()
            } else if !is_strings_equal_std(imported_name, temp_export) {
                concat(&[imported_name, b" as ", temp_export])
            } else if strings::contains_char(temp_export, b'"') {
                temp_export.to_vec()
            } else {
                imported_name.to_vec()
            }
        }
        Specifier::Namespace(_) => display_name(exported),
    }
}

/// Whether both are strings in quotes which, taken for strings of JSON, have the same value.
fn is_strings_equal_std(s1: &[u8], s2: &[u8]) -> bool {
    fn clean(s: &[u8]) -> Option<Vec<u8>> {
        let [b'\'' | b'"', inner @ .., b'\'' | b'"'] = s else {
            return None;
        };
        let hex4 = |digits: &[u8]| {
            let digits = digits.get(..4).filter(|it| it.iter().all(u8::is_ascii_hexdigit))?;
            u32::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok()
        };
        let mut decoded = Vec::with_capacity(inner.len());
        let mut rest = inner;
        while let Some((&byte, after)) = rest.split_first() {
            rest = after;
            match byte {
                b'"' | 0..=0x1F => return None,
                b'\\' => {
                    let (&escaped, after) = rest.split_first()?;
                    rest = after;
                    let code_point = match escaped {
                        b'"' | b'\\' | b'/' => u32::from(escaped),
                        b'b' => 0x08,
                        b'f' => 0x0C,
                        b'n' => 0x0A,
                        b'r' => 0x0D,
                        b't' => 0x09,
                        b'u' => {
                            let high = hex4(rest)?;
                            rest = rest.get(4..)?;
                            if (0xD800..0xDC00).contains(&high) {
                                let low = hex4(rest.strip_prefix(b"\\u")?).filter(|it| (0xDC00..0xE000).contains(it))?;
                                rest = rest.get(6..)?;
                                0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)
                            } else {
                                high
                            }
                        }
                        _ => return None,
                    };
                    decoded.extend_from_slice(char::from_u32(code_point)?.encode_utf8(&mut [0; 4]).as_bytes());
                }
                _ => decoded.push(byte),
            }
        }
        Some(decoded)
    }
    clean(s1).is_some_and(|s1| Some(s1) == clean(s2))
}

/// The first `export { .. } from` the same module, of the same kind and with the same attributes.
fn find_corresponding_export<'a>(import_decl: Import<'a>, cx: &mut Cx<'a, PreferExportFrom>) -> Option<Export<'a>> {
    let file = cx.file();
    let exports_from = cx.state.exports_from.get_or_insert_with(|| {
        let mut exports_from: FxHashMap<Name<'a>, SmallVec<[Export<'a>; 1]>> = FxHashMap::default();
        for statement in file.body() {
            if let StmtKind::ExportNamed(export_decl) = statement.kind()
                && let Some(source) = export_decl.spec()
            {
                exports_from.entry(source).or_default().push(export_decl);
            }
        }
        exports_from
    });
    let with_clause = |it: Option<ImportAttributes<'a>>| it.map(|it| file.slice(it.braces_span()));
    exports_from.get(&import_decl.spec())?.iter().copied().find(|export_decl| {
        (import_decl.is_type_only() == export_decl.is_type_only()
            || import_decl.is_type_only() && export_decl.items().iter().all(ExportSpec::is_type_only))
            && with_clause(import_decl.attributes()) == with_clause(export_decl.attributes())
    })
}

/// From the end of `statement` to the next statement of the file.
fn get_replace_span(statement: Stmt) -> Span {
    let span = statement.span();
    let next = match statement.parent() {
        Node::File(file) => file.body().after(span.start),
        _ => None,
    };
    next.map_or_else(|| Span::empty(span.end), |it| span.between(it.span()))
}

fn format_export_names(violations: &[Violation]) -> Vec<u8> {
    let mut names = Vec::new();
    for (i, violation) in violations.iter().enumerate() {
        names.extend_from_slice(if i == 0 { "" } else { ", " }.as_bytes());
        names.extend_from_slice(if violation.is_typescript_type { "type " } else { "" }.as_bytes());
        names.extend_from_slice(&violation.export_name);
    }
    names
}

/// The violations of an import that are fixed together: those that export the namespace, or the others.
struct Group<'g, 'a> {
    import_decl: Import<'a>,
    specifiers: &'g [SpecifierSpec<'a>],
    violations: &'g [Violation<'a>],
    re_export_decl: Option<Export<'a>>,
    is_namespace: bool,
}

impl<'a> Group<'_, 'a> {
    /// `with { type: "json" }`, with a space before it.
    fn with_clause(&self) -> Vec<u8> {
        let Some(with_clause) = self.import_decl.attributes() else {
            return Vec::new();
        };
        let file = self.import_decl.stmt().file();
        let mut clause = concat(&[b" ", file.slice(with_clause.keyword_span()), b" { "]);
        for (i, attribute) in with_clause.entries().iter().enumerate() {
            let key = attribute.key().and_then(Key::name).map_or(&b""[..], Name::bytes);
            let value = attribute.value().map_or(&b""[..], Expr::text);
            let separator: &[u8] = if i == 0 { b"" } else { b", " };
            clause.extend_from_slice(&concat(&[separator, key, b": ", value]));
        }
        clause.extend_from_slice(b" }");
        clause
    }

    /// The statements that export the same from the module.
    fn generate_export_format(&self) -> Vec<u8> {
        let after = concat(&[b" from '", self.import_decl.spec().bytes(), b"'", &self.with_clause(), b";\n"]);
        if !self.is_namespace {
            return concat(&[b"export { ", &format_export_names(self.violations), b" }", &after]);
        }
        let mut format = Vec::new();
        for violation in self.violations {
            let keyword: &[u8] = if violation.is_typescript_type { b"export type " } else { b"export " };
            format.extend_from_slice(&concat(&[keyword, &violation.export_name, &after]));
        }
        format
    }

    fn fix(&self, fixer: Fixer<'a>, violation: &Violation<'a>) -> Option<Vec<Fix>> {
        let file = fixer.file();
        let replacement_str = self.generate_export_format();
        if violation.needs_source {
            return Some(vec![fixer.replace(violation.export_node, replacement_str)]);
        }
        let import_span = self.import_decl.stmt().span();
        let replace_span = get_replace_span(self.import_decl.stmt());
        let mut parent_nodes: Vec<Stmt<'a>> = self.violations.iter().map(|it| it.export_node).collect();
        utils::sort::sort_unstable_by_key(&mut parent_nodes, |it| it.span().start);
        let delete_span = parent_nodes.first()?.span().to(parent_nodes.last()?.span());
        let exports_str = if self.is_namespace { violation.export_name.clone() } else { format_export_names(self.violations) };

        let mut is_exported = vec![false; self.specifiers.len()];
        for violation in self.violations {
            *is_exported.get_mut(violation.specifier_index)? = true;
        }
        let retained_specifiers: Vec<&SpecifierSpec<'a>> =
            self.specifiers.iter().zip(is_exported).filter(|(it, is_exported)| !is_exported || it.is_locally_used).map(|it| it.0).collect();

        // After the last specifier of the `export { .. } from`, or after its `{`.
        let last_export = self.re_export_decl.and_then(|re_export| {
            let (last_specifier, span) = (re_export.items().last(), re_export.stmt().span());
            let end = match last_specifier {
                Some(specifier) => specifier.span().end,
                None => find_next_token_within(file, span, b"{")? + 1,
            };
            Some((re_export, last_specifier, Span::empty(end)))
        });
        if self.re_export_decl.is_some() && last_export.is_none() {
            return None;
        }

        let mut rule_fixes = Vec::new();
        match (last_export, retained_specifiers.is_empty()) {
            (None, true) => {
                rule_fixes.push(fixer.remove(replace_span));
                rule_fixes.push(fixer.replace(import_span, replacement_str));
            }
            (Some((re_export, last_specifier, last_export_span)), true) => {
                let processed_exports_str = match re_export.is_type_only() {
                    true => strings::split(&exports_str, b"type ").collect::<Vec<_>>().concat(),
                    false => exports_str,
                };
                if self.is_namespace {
                    let source = file.slice(re_export.spec_span()?);
                    rule_fixes.push(fixer.replace(import_span, concat(&[b"export ", &processed_exports_str, b" from ", source])));
                } else {
                    // Not the character after the specifier, but the one after that.
                    let has_comma = last_specifier.is_none_or(|specifier| {
                        let dot_index = (specifier.span().end + 1).saturating_sub(re_export.stmt().span().start);
                        re_export.stmt().text().chars().nth(dot_index as usize) == Some(',')
                    });
                    let separator: &[u8] = if has_comma { b"" } else { b", " };
                    rule_fixes.push(fixer.insert_after(last_export_span, concat(&[separator, &processed_exports_str])));
                    rule_fixes.push(fixer.remove(import_span));
                    rule_fixes.push(fixer.remove(replace_span));
                    rule_fixes.extend(parent_nodes.iter().map(|it| fixer.remove(get_replace_span(*it))));
                }
            }
            (last_export, false) => {
                rule_fixes.push(fixer.remove(replace_span));
                let new_import_str = self.build_new_import_declaration(&retained_specifiers);
                match last_export {
                    Some((_, last_specifier, last_export_span)) => {
                        let comma: &[u8] = if last_specifier.is_some() { b", " } else { b"" };
                        rule_fixes.push(fixer.insert_after(last_export_span, concat(&[comma, &exports_str])));
                        rule_fixes.push(fixer.replace(import_span, new_import_str));
                    }
                    None => rule_fixes.push(fixer.replace(import_span, concat(&[&new_import_str, &replacement_str]))),
                }
            }
        }
        rule_fixes.push(fixer.remove(delete_span));
        Some(rule_fixes)
    }

    /// The import with what is left of it.
    fn build_new_import_declaration(&self, retained_specifiers: &[&SpecifierSpec<'a>]) -> Vec<u8> {
        let file = self.import_decl.stmt().file();
        let (mut default_import, mut namespace_import, mut named_imports) = (None, None, Vec::new());
        for spec in retained_specifiers {
            match spec.specifier {
                Specifier::Default(local) => default_import = Some(file.slice(local.span())),
                Specifier::Namespace(span) => namespace_import = Some(file.slice(span)),
                Specifier::Named(import_specifier) => named_imports.push(import_specifier.text()),
            }
        }
        let named_imports = (!named_imports.is_empty()).then(|| concat(&[b"{", &named_imports.join(&b", "[..]), b"}"]));
        let result_parts: Vec<&[u8]> = default_import.into_iter().chain(namespace_import).chain(named_imports.as_deref()).collect();
        // Of the attributes oxlint keeps the braces only.
        let with_clause = self.import_decl.attributes().map_or_else(Vec::new, |it| concat(&[b" ", file.slice(it.braces_span())]));
        let keyword: &[u8] = if self.import_decl.is_type_only() { b"import type " } else { b"import " };
        concat(&[
            keyword,
            &result_parts.join(&b", "[..]),
            b" from ",
            self.import_decl.spec_span().map_or(&b""[..], |it| file.slice(it)),
            &with_clause,
            b";\n",
        ])
    }
}
