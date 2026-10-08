use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{is_closing_brace_token, is_comma_token, is_opening_brace_token};
use bun_lint::utils::text::trim;
use bun_lint::utils::ts_utils::format_word_list;
use rustc_hash::FxHashMap;

/// Enforce consistent usage of type imports.
pub struct ConsistentTypeImports {
    disallow_type_annotations: bool,
    /// `fixStyle` is `"inline-type-imports"`, not `"separate-type-imports"`.
    fixes_inline: bool,
    /// `prefer` is `"type-imports"`, not `"no-type-imports"`.
    prefers_type_imports: bool,
}

const AVOID_IMPORT_TYPE: Message =
    Message::new("avoidImportType", "Use an `import` instead of an `import type`.");
const NO_IMPORT_TYPE_ANNOTATIONS: Message = Message::new(
    "noImportTypeAnnotations",
    "`import()` type annotations are forbidden.",
);
const SOME_IMPORTS_ARE_ONLY_TYPES: Message = Message::new(
    "someImportsAreOnlyTypes",
    "Imports {{typeImports}} are only used as type.",
);
const TYPE_OVER_VALUE: Message = Message::new(
    "typeOverValue",
    "All imports in the declaration are only used as types. Use `import type`.",
);

#[derive(Default)]
pub struct State<'a> {
    imports: Vec<Import<'a>>,
    /// There is a decorator, in a file for which `experimentalDecorators` and
    /// `emitDecoratorMetadata` are on: a type next to it can be needed as a value.
    has_decorator_metadata: bool,
}

/// An `ImportDefaultSpecifier`, an `ImportNamespaceSpecifier` or an `ImportSpecifier`.
#[derive(Copy, Clone, PartialEq)]
enum Specifier<'a> {
    Default(Import<'a>),
    Namespace(Import<'a>),
    Named(ImportSpec<'a>),
}

impl<'a> Specifier<'a> {
    fn local(self) -> Option<Ident<'a>> {
        match self {
            Specifier::Default(import) => import.default(),
            Specifier::Namespace(import) => import.namespace(),
            Specifier::Named(spec) => Some(spec.local()),
        }
    }
}

/// `node.specifiers`
fn specifiers_of<'a>(import: Import<'a>) -> impl Iterator<Item = Specifier<'a>> {
    let default = import.default().map(|_| Specifier::Default(import));
    let namespace = import.namespace().map(|_| Specifier::Namespace(import));
    default.into_iter().chain(namespace).chain(import.named().iter().map(Specifier::Named))
}

/// What is known of all the imports from one module.
#[derive(Default)]
struct SourceImports<'a> {
    /// The first `import type` with nothing but named imports.
    type_only_named_import: Option<Import<'a>>,
    /// The first import of values with named imports only, or else with a default import.
    value_import: Option<Import<'a>>,
    /// The first import of values with nothing but named imports.
    value_only_named_import: Option<Import<'a>>,
}

/// An import of values of which some are only used as types.
struct ReportValueImport<'a> {
    import: Import<'a>,
    /// At least one.
    type_specifiers: Vec<Specifier<'a>>,
    has_value_or_unused_specifiers: bool,
}

impl<'a> ReportValueImport<'a> {
    fn is_type(&self, specifier: Specifier<'a>) -> bool {
        self.type_specifiers.contains(&specifier)
    }
}

fn concat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

fn import_keyword(import: Import) -> Span {
    let start = import.span().start;
    Span::new(start, start + "import".len() as u32)
}

/// `node.attributes.length > 0`
fn has_attributes(import: Import) -> bool {
    (import.stmt().import_attributes()).is_some_and(|attributes| !attributes.entries().is_empty())
}

/// Whether an `import type` would do for `reference`.
fn is_type_only_use(reference: Reference) -> bool {
    if !reference.is_value() {
        return reference.is_type();
    }
    // `export { Type }`, `export default Type` and `export = Type` keep the kind of the import.
    if reference.is_type() {
        return false;
    }
    let Some(mut child) = reference.expr() else {
        return false;
    };
    loop {
        match child.parent() {
            // `typeof foo.bar`
            Node::Type(ty) => return ty.tag() == TypeTag::Typeof,
            // `{ [foo.bar]: string }`
            Node::Member(member) => {
                return member.kind() == MemberKind::Property
                    && !matches!(member.parent(), Node::Class(_))
                    && matches!(member.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == child);
            }
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot {
                    obj,
                    chain: Chain::No,
                    ..
                }
                | ExprKind::Index {
                    obj,
                    chain: Chain::No,
                    ..
                } if obj == child => child = parent,
                _ => return false,
            },
            _ => return false,
        }
    }
}

/// `import { type Foo }`: removes the `type`.
fn fix_remove_type_specifier_from_import_specifier<'a>(
    fixer: Fixer<'a>,
    spec: ImportSpec<'a>,
) -> Option<Fix> {
    let start = spec.span().start;
    let type_token = Span::new(start, start + "type".len() as u32);
    let after = fixer.file().tokens_after(type_token).with_comments().next()?;
    Some(fixer.remove(Span::new(start, after.start())))
}

/// `import type Foo`: removes the `type`.
fn fix_remove_type_specifier_from_import_declaration<'a>(
    fixer: Fixer<'a>,
    import: Import<'a>,
) -> Option<Fix> {
    let file = fixer.file();
    let type_token = file.tokens_after(import_keyword(import)).next().filter(|it| it.is("type"))?;
    let after = file.tokens_after(type_token).with_comments().next()?;
    Some(fixer.remove(Span::new(type_token.start(), after.start())))
}

/// `import Foo` to `import type Foo`.
fn fix_insert_type_specifier_for_import_declaration<'a>(
    fixer: Fixer<'a>,
    import: Import<'a>,
    is_default_import: bool,
    fixes: &mut Vec<Fix>,
) -> Option<()> {
    let (file, import_token) = (fixer.file(), import_keyword(import));
    fixes.push(fixer.insert_after(import_token, " type"));
    if is_default_import {
        let source = import.stmt().module_specifier_span()?;
        // `import Foo, {} from 'foo'`
        let opening = file.tokens_between(import_token, source).find(is_opening_brace_token);
        if let Some(opening) = opening {
            let comma = file.tokens_before(opening).find(is_comma_token)?;
            let closing = file.tokens_between(opening, source).find(is_closing_brace_token)?;
            fixes.push(fixer.remove(Span::new(comma.start(), closing.end())));
            if specifiers_of(import).count() > 1 {
                let specifiers_text = file.slice(Span::new(comma.end(), closing.end()));
                let text =
                    concat(&[b"\nimport type", specifiers_text, b" from ", file.slice(source), b";"]);
                fixes.push(fixer.insert_after(import.stmt(), text));
            }
        }
    }
    // Not `import type { type T }`.
    for spec in import.named() {
        if spec.is_type_only() {
            fixes.push(fix_remove_type_specifier_from_import_specifier(fixer, spec)?);
        }
    }
    Some(())
}

/// What to remove to remove the specifiers from `first` to `last`, and the text to put between
/// braces to import them.
fn get_named_specifier_ranges<'a>(
    file: &'a File<'a>,
    first: ImportSpec<'a>,
    last: ImportSpec<'a>,
) -> Option<(Span, Span)> {
    let all = first.import().named();
    let before = file.tokens_before(first).next()?;
    let after = file.tokens_after(last).next()?;
    let remove_start = match is_comma_token(&before) {
        true => before.start(),
        false => before.end(),
    };
    let is_first_or_last = all.first() == Some(first) || all.last() == Some(last);
    let remove_end = match is_first_or_last && is_comma_token(&after) {
        true => after.end(),
        false => last.span().end,
    };
    Some((
        Span::new(remove_start, remove_end),
        Span::new(before.end(), after.start()),
    ))
}

/// How to remove `subset` from the named specifiers of `import`, and the text to put between braces
/// to import them.
fn get_fixes_named_specifiers<'a>(
    fixer: Fixer<'a>,
    import: Import<'a>,
    subset: &[ImportSpec<'a>],
) -> Option<(Vec<Fix>, Vec<u8>)> {
    let (file, all) = (fixer.file(), import.named());
    let mut removals = Vec::new();
    let mut texts: Vec<&[u8]> = Vec::new();
    if all.is_empty() {
        return Some((removals, Vec::new()));
    }
    if subset.len() == all.len() {
        // `import Foo, { Type1, Type2 } from 'foo'`: from the comma to the closing brace.
        let source = import.stmt().module_specifier_span()?;
        let opening = file.tokens_before(*subset.first()?).find(is_opening_brace_token)?;
        let comma = file.tokens_before(opening).find(is_comma_token)?;
        let closing = file.tokens_between(opening, source).find(is_closing_brace_token)?;
        removals.push(fixer.remove(Span::new(comma.start(), closing.end())));
        texts.push(file.slice(Span::new(opening.end(), closing.start())));
    } else {
        // Each run of adjacent specifiers.
        let mut groups: Vec<(ImportSpec, ImportSpec)> = Vec::new();
        let mut group: Option<(ImportSpec, ImportSpec)> = None;
        for spec in all {
            if subset.contains(&spec) {
                group = Some((group.map_or(spec, |it| it.0), spec));
            } else {
                groups.extend(group.take());
            }
        }
        groups.extend(group);
        for (first, last) in groups {
            let (remove, text) = get_named_specifier_ranges(file, first, last)?;
            removals.push(fixer.remove(remove));
            texts.push(file.slice(text));
        }
    }
    Some((removals, texts.join(&b","[..])))
}

/// `import type { Already } from 'foo'` to `import type { Already, Type1, Type2 } from 'foo'`.
fn fix_insert_named_specifiers_in_named_specifier_list<'a>(
    fixer: Fixer<'a>,
    target: Import<'a>,
    insert_text: &[u8],
) -> Option<Fix> {
    let (file, source) = (fixer.file(), target.stmt().module_specifier_span()?);
    let closing = file
        .tokens_between(import_keyword(target), source)
        .find(is_closing_brace_token)?;
    let before = file.tokens_before(closing).next()?;
    let separator: &[u8] = match is_comma_token(&before) || is_opening_brace_token(&before) {
        true => b"",
        false => b",",
    };
    Some(fixer.insert_before(closing, concat(&[separator, insert_text])))
}

/// `import A, { B }` to `import A, { type B }`.
fn fix_inline_type_import_declaration<'a>(
    fixer: Fixer<'a>,
    report: &ReportValueImport<'a>,
    source_imports: &SourceImports<'a>,
    fixes: &mut Vec<Fix>,
) {
    let Some(value_import) = source_imports.value_import else {
        return;
    };
    if source_imports.value_only_named_import.is_none() && value_import.named().is_empty() {
        return;
    }
    for spec in report.import.named() {
        if report.is_type(Specifier::Named(spec)) {
            fixes.push(fixer.replace(spec, concat(&[b"type ", spec.text()])));
        }
    }
}

impl ConsistentTypeImports {
    fn fix_to_type_import_declaration<'a>(
        &self,
        fixer: Fixer<'a>,
        report: &ReportValueImport<'a>,
        source_imports: &SourceImports<'a>,
    ) -> Option<Vec<Fix>> {
        let (file, import) = (fixer.file(), report.import);
        let statement = import.stmt();
        let named = import.named();
        let has_namespace = import.namespace().is_some();
        let is_default_type = report.is_type(Specifier::Default(import));
        let is_named_type = |spec: ImportSpec<'a>| report.is_type(Specifier::Named(spec));
        let mut fixes = Vec::new();

        if has_namespace && import.default().is_none() {
            // `import * as types from 'foo'`
            if !has_attributes(import) {
                fix_insert_type_specifier_for_import_declaration(fixer, import, false, &mut fixes)?;
            }
            return Some(fixes);
        }
        if import.default().is_some() {
            if is_default_type && named.is_empty() && !has_namespace {
                // `import Type from 'foo'`
                fix_insert_type_specifier_for_import_declaration(fixer, import, true, &mut fixes)?;
                return Some(fixes);
            }
            if self.fixes_inline && !is_default_type && !named.is_empty() && !has_namespace {
                // `import AValue, { BValue, Type1, Type2 } from 'foo'`
                fix_inline_type_import_declaration(fixer, report, source_imports, &mut fixes);
                return Some(fixes);
            }
        } else if !has_namespace {
            if self.fixes_inline && named.iter().any(is_named_type) {
                // `import { AValue, Type1, Type2 } from 'foo'`
                fix_inline_type_import_declaration(fixer, report, source_imports, &mut fixes);
                return Some(fixes);
            }
            if named.iter().all(is_named_type) {
                // `import { Type1, Type2 } from 'foo'`
                fix_insert_type_specifier_for_import_declaration(fixer, import, false, &mut fixes)?;
                return Some(fixes);
            }
        }

        let source_text = file.slice(statement.module_specifier_span()?);
        let type_named: Vec<ImportSpec> = named.iter().filter(|spec| is_named_type(*spec)).collect();
        let (remove_type_named, type_named_text) =
            get_fixes_named_specifiers(fixer, import, &type_named)?;
        let mut after_fixes = Vec::new();
        if !type_named.is_empty() {
            if let Some(target) = source_imports.type_only_named_import {
                let insert = fix_insert_named_specifiers_in_named_specifier_list(
                    fixer,
                    target,
                    &type_named_text,
                )?;
                if target.span().end <= statement.span().start {
                    fixes.push(insert);
                } else {
                    after_fixes.push(insert);
                }
            } else if self.fixes_inline {
                // A default type import and named type imports cannot be in one declaration.
                let mut text = b"import {".to_vec();
                for (i, spec) in type_named.iter().enumerate() {
                    if i > 0 {
                        text.extend_from_slice(b", ");
                    }
                    text.extend_from_slice(b"type ");
                    text.extend_from_slice(spec.text());
                }
                text.extend_from_slice(&concat(&[b"} from ", source_text, b";\n"]));
                fixes.push(fixer.insert_before(statement, text));
            } else {
                let text =
                    concat(&[b"import type {", &type_named_text, b"} from ", source_text, b";\n"]);
                fixes.push(fixer.insert_before(statement, text));
            }
        }

        let mut remove_type_namespace = None;
        if has_namespace && report.is_type(Specifier::Namespace(import)) {
            // `import Foo, * as Type from 'foo'`
            let namespace = import.namespace_span()?;
            let comma = file.tokens_before(namespace).find(is_comma_token)?;
            remove_type_namespace = Some(fixer.remove(Span::new(comma.start(), namespace.end)));
            let text =
                concat(&[b"import type ", file.slice(namespace), b" from ", source_text, b";\n"]);
            fixes.push(fixer.insert_before(statement, text));
        }
        if is_default_type {
            let default = import.default()?.span();
            if report.type_specifiers.len() == specifiers_of(import).count() {
                fixes.push(fixer.insert_after(import_keyword(import), " type"));
            } else {
                // `import Type , { .. } from 'foo'`
                let comma = file.tokens_after(default).find(is_comma_token)?;
                let default_text = trim(file.slice(Span::new(default.start, comma.start())));
                let text = concat(&[b"import type ", default_text, b" from ", source_text, b";\n"]);
                fixes.push(fixer.insert_before(statement, text));
                let after = file.tokens_after(comma).with_comments().next()?;
                fixes.push(fixer.remove(Span::new(default.start, after.start())));
            }
        }
        fixes.extend(remove_type_named);
        fixes.extend(remove_type_namespace);
        fixes.extend(after_fixes);
        Some(fixes)
    }

    fn check_imports<'a>(&self, cx: &mut Cx<'a, Self>) {
        if cx.state.has_decorator_metadata {
            return;
        }
        let mut imports = std::mem::take(&mut cx.state.imports);
        imports.sort_unstable_by_key(|import| import.span().start);

        let mut sources: FxHashMap<Name<'a>, SourceImports<'a>> = FxHashMap::default();
        let mut reports: Vec<ReportValueImport<'a>> = Vec::new();
        for import in imports {
            let source_imports = sources.entry(import.spec()).or_default();
            let has_only_named = import.default().is_none() && import.namespace().is_none();
            if import.is_type_only() {
                if has_only_named {
                    source_imports.type_only_named_import.get_or_insert(import);
                }
                continue;
            }
            if source_imports.value_only_named_import.is_none()
                && has_only_named
                && !import.named().is_empty()
            {
                source_imports.value_only_named_import = Some(import);
                source_imports.value_import = Some(import);
            } else if import.default().is_some() {
                source_imports.value_import.get_or_insert(import);
            }

            let scope = Node::Stmt(import.stmt()).scope();
            let mut type_specifiers = Vec::new();
            let mut has_value_or_unused_specifiers = false;
            for specifier in specifiers_of(import) {
                if matches!(specifier, Specifier::Named(spec) if spec.is_type_only()) {
                    continue;
                }
                let variable = specifier.local().and_then(|local| scope.get_name(local.name()));
                let has_only_type_references = variable.is_some_and(|variable| {
                    let mut references = variable.references();
                    references.len() > 0 && references.all(is_type_only_use)
                });
                match has_only_type_references {
                    true => type_specifiers.push(specifier),
                    false => has_value_or_unused_specifiers = true,
                }
            }
            if !type_specifiers.is_empty() {
                reports.push(ReportValueImport {
                    import,
                    type_specifiers,
                    has_value_or_unused_specifiers,
                });
            }
        }

        for report in &reports {
            let Some(source_imports) = sources.get(&report.import.spec()) else {
                continue;
            };
            let statement = report.import.stmt();
            if report.has_value_or_unused_specifiers {
                let names: Vec<Vec<u8>> = (report.type_specifiers.iter())
                    .filter_map(|specifier| specifier.local())
                    .map(|local| concat(&[b"\"", local.bytes(), b"\""]))
                    .collect();
                cx.report(statement, SOME_IMPORTS_ARE_ONLY_TYPES)
                    .data("typeImports", format_word_list(&names))
                    .fix(|fixer| self.fix_to_type_import_declaration(fixer, report, source_imports));
            } else if !has_attributes(report.import) {
                cx.report(statement, TYPE_OVER_VALUE)
                    .fix(|fixer| self.fix_to_type_import_declaration(fixer, report, source_imports));
            }
        }
    }
}

impl Rule for ConsistentTypeImports {
    const META: Meta =
        Meta::typescript("consistent-type-imports", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let option = options.object(0);
        ConsistentTypeImports {
            disallow_type_annotations: option.bool_or("disallowTypeAnnotations", true),
            fixes_inline: option.str("fixStyle") == Some("inline-type-imports"),
            prefers_type_imports: option.str("prefer") != Some("no-type-imports"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if self.disallow_type_annotations {
            on.types([TypeTag::Import], |_, ty, cx| {
                if let Some(span) = ty.import_span() {
                    cx.report(span, NO_IMPORT_TYPE_ANNOTATIONS);
                }
            });
        }

        if !self.prefers_type_imports {
            on.stmts([StmtTag::Import], |_, statement, cx| {
                if let StmtKind::Import(import) = statement.kind()
                    && import.is_type_only()
                {
                    cx.report(statement, AVOID_IMPORT_TYPE).fix(|fixer| {
                        fix_remove_type_specifier_from_import_declaration(fixer, import)
                    });
                }
            });
            on.import_specs(|_, spec, cx| {
                if spec.is_type_only() {
                    cx.report(spec, AVOID_IMPORT_TYPE)
                        .fix(|fixer| fix_remove_type_specifier_from_import_specifier(fixer, spec));
                }
            });
            return State::default();
        }

        // `parserOptions` say it only where there is no program to say it.
        let (experimental_decorators, emit_decorator_metadata) = match file.types() {
            Some(types) => {
                let options = types.compiler_options();
                (options.experimental_decorators, options.emit_decorator_metadata)
            }
            None => (file.language().experimental_decorators, file.language().emit_decorator_metadata),
        };
        if experimental_decorators && emit_decorator_metadata {
            on.classes(|_, class, cx| {
                cx.state.has_decorator_metadata |= class.decorators().next().is_some();
            });
            on.members(|_, member, cx| {
                cx.state.has_decorator_metadata |= member.decorators().next().is_some();
            });
            on.params(|_, param, cx| {
                cx.state.has_decorator_metadata |= param.decorators().next().is_some();
            });
        }
        on.stmts([StmtTag::Import], |_, statement, cx| {
            if let StmtKind::Import(import) = statement.kind() {
                cx.state.imports.push(import);
            }
        });
        on.finish(Self::check_imports);
        State::default()
    }
}
