use bun_lint::prelude::*;
use bun_lint::types::{IdSet, NameOf, SymbolFlags, TsSymbol, TypeFlags};
use bun_lint::utils::ts_utils::format_word_list;

/// Enforce consistent usage of type exports.
pub struct ConsistentTypeExports {
    fix_mixed_exports_with_inline_type_specifier: bool,
}

const MULTIPLE_EXPORTS_ARE_TYPES: Message = Message::new(
    "multipleExportsAreTypes",
    "Type exports {{exportNames}} are not values and should be exported using `export type`.",
);
const SINGLE_EXPORT_IS_TYPE: Message = Message::new(
    "singleExportIsType",
    "Type export {{exportNames}} is not a value and should be exported using `export type`.",
);
const TYPE_OVER_VALUE: Message = Message::new(
    "typeOverValue",
    "All exports in the declaration are only used as types. Use `export type`.",
);

/// The specifiers of an `export { .. }` that is not an `export type { .. }`. Those that cannot be
/// resolved are in none of the lists.
struct ReportValueExport<'a> {
    inline_type_specifiers: Vec<ExportSpec<'a>>,
    type_based_specifiers: Vec<ExportSpec<'a>>,
    value_specifiers: Vec<ExportSpec<'a>>,
    /// tsgolint's `typeTexts`: the inline and the type based specifiers in the order they are written. Only with oxlint.
    type_specifiers: Vec<ExportSpec<'a>>,
    /// All the others in the order they are written. Only with oxlint.
    value_or_unresolved_specifiers: Vec<ExportSpec<'a>>,
}

/// Whether a symbol resolves to a TypeScript type and not to a JavaScript value. `None` if it
/// cannot be resolved.
fn is_symbol_type_based(symbol: Option<TsSymbol>) -> Option<bool> {
    let mut symbol = symbol?;
    // Aliases can form a cycle through other modules.
    let mut seen: IdSet<TsSymbol> = IdSet::new();
    while seen.insert(symbol) {
        if symbol.is_unknown() {
            return None;
        }
        if symbol.declarations().any(|it| it.is_type_only_import_or_export_declaration()) {
            return Some(true);
        }
        if symbol.has_flags(SymbolFlags::VALUE) {
            return Some(false);
        }
        if !symbol.has_flags(SymbolFlags::ALIAS) {
            return Some(true);
        }
        symbol = symbol.get_immediate_aliased_symbol()?;
    }
    None
}

fn is_specifier_type_based(specifier: ExportSpec, is_oxlint: bool) -> Option<bool> {
    // tsgolint asks at the `propertyName` of `a as b`: the immediate alias of the specifier.
    let property_name = match is_oxlint {
        true => specifier.ts_node().property_name(),
        false => None,
    };
    is_symbol_type_based(match property_name {
        Some(property_name) => property_name.get_symbol_at_location(),
        None => NameOf(specifier).ts_symbol(),
    })
}

/// `raw` of a `Literal`, `name` of an `Identifier`.
fn get_name_text<'a>(file: &'a File<'a>, name: Ident<'a>) -> &'a [u8] {
    match name.is_string() {
        true => file.slice(name.span()),
        false => name.bytes(),
    }
}

/// `local as exported`, or `local` if both are the same.
fn push_specifier_text<'a>(out: &mut Vec<u8>, file: &'a File<'a>, specifier: ExportSpec<'a>) {
    let exported_name = get_name_text(file, specifier.exported());
    let local_name = get_name_text(file, specifier.local());
    out.extend_from_slice(local_name);
    if exported_name != local_name {
        out.extend_from_slice(b" as ");
        out.extend_from_slice(exported_name);
    }
}

fn join_specifier_texts<'a>(
    file: &'a File<'a>,
    specifiers: impl Iterator<Item = ExportSpec<'a>>,
) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, specifier) in specifiers.enumerate() {
        if i > 0 {
            out.extend_from_slice(b", ");
        }
        push_specifier_text(&mut out, file, specifier);
    }
    out
}

/// `export type { Foo } from 'foo';`: inserts the `type`, and removes it from the specifiers.
fn fix_export_insert_type<'a>(fixer: Fixer<'a>, export: Export<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let export_token = file.first_token(export.stmt())?;
    let mut fixes = vec![fixer.insert_after(export_token, " type")];
    for specifier in export.items() {
        if specifier.is_type_only() {
            let kind_token = file.first_token(specifier)?;
            let first_token_after = file.tokens_after(kind_token).with_comments().next()?;
            fixes.push(fixer.remove(Span::new(kind_token.start(), first_token_after.start())));
        }
    }
    Some(fixes)
}

/// Moves the specifiers that are types to an `export type { .. }` before the export.
fn fix_separate_named_exports<'a>(
    fixer: Fixer<'a>,
    export: Export<'a>,
    report: &ReportValueExport<'a>,
) -> Option<Vec<Fix>> {
    let (file, node) = (fixer.file(), export.stmt());
    let type_specifiers = report.type_based_specifiers.iter().chain(&report.inline_type_specifiers);
    let specifier_names = join_specifier_texts(file, type_specifiers.copied());
    let export_token = file.first_token(node)?;

    let filtered_specifier_names = join_specifier_texts(file, report.value_specifiers.iter().copied());
    let open_token = file.tokens_in(node).find(|token| token.is_punctuator("{"))?;
    let close_token = file.tokens_in(node).rfind(|token| token.is_punctuator("}"))?;

    let mut type_export = [&b"export type { "[..], specifier_names.as_slice(), b" }"].concat();
    if let Some(source) = export.spec().filter(|source| !source.bytes().is_empty()) {
        type_export.extend_from_slice(b" from '");
        type_export.extend_from_slice(source.bytes());
        type_export.push(b'\'');
    }
    type_export.extend_from_slice(b";\n");

    Some(vec![
        fixer.replace(
            Span::new(open_token.end(), close_token.start()),
            [&b" "[..], filtered_specifier_names.as_slice(), b" "].concat(),
        ),
        fixer.insert_before(export_token, type_export),
    ])
}

/// tsgolint's `buildNamedExportStatement`, without the `;`.
fn push_named_export_statement<'a>(
    out: &mut Vec<u8>,
    file: &'a File<'a>,
    keywords: &[u8],
    specifiers: &[ExportSpec<'a>],
    module_source: &[u8],
) {
    out.extend_from_slice(keywords);
    out.extend_from_slice(b" { ");
    out.extend_from_slice(&join_specifier_texts(file, specifiers.iter().copied()));
    out.extend_from_slice(b" }");
    if !module_source.is_empty() {
        out.extend_from_slice(b" from ");
        out.extend_from_slice(module_source);
    }
}

/// tsgolint replaces the declaration by an `export type { .. }` and an `export { .. }` of the values, each on a
/// line. It leaves out the specifiers that cannot be resolved and the import attributes: the second statement
/// keeps both here, so that what was exported at run time still is.
fn fix_replace_named_exports<'a>(
    fixer: Fixer<'a>,
    export: Export<'a>,
    report: &ReportValueExport<'a>,
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let module_source = export.spec_span().map_or(&b""[..], |span| file.slice(span));
    let mut text = Vec::new();
    push_named_export_statement(&mut text, file, b"export type", &report.type_specifiers, module_source);
    text.push(b';');
    if !report.value_or_unresolved_specifiers.is_empty() {
        text.push(b'\n');
        push_named_export_statement(&mut text, file, b"export", &report.value_or_unresolved_specifiers, module_source);
        if let Some(attributes) = export.attributes() {
            text.push(b' ');
            text.extend_from_slice(file.slice(Span::new(attributes.keyword_span().start, attributes.braces_span().end)));
        }
        text.push(b';');
    }
    Some(vec![fixer.replace(export.stmt().span(), text)])
}

fn fix_add_type_specifier_to_named_exports<'a>(
    fixer: Fixer<'a>,
    report: &ReportValueExport<'a>,
) -> Vec<Fix> {
    let specifiers = report.type_based_specifiers.iter();
    specifiers.map(|specifier| fixer.insert_before(specifier, "type ")).collect()
}

/// Where it says that all that is exported are types: oxlint points at the `export`.
fn place_of_all(node: Stmt, cx: &Cx<'_, ConsistentTypeExports>) -> Span {
    let Span { start, end } = node.span();
    Span::new(start, if cx.language().is_oxlint { start + "export".len() as u32 } else { end })
}

impl ConsistentTypeExports {
    fn check_export_all<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ExportStar {
            spec: Some(source),
            type_only: false,
            ..
        } = node.kind()
        else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let types = cx.file().type_checker();
        // tsgolint asks at the module specifier: a `declare module "name"` of that name comes before a file.
        let ambient_module = if is_oxlint { types.get_ambient_module(source.bytes()) } else { None };
        let source_file_symbol = ambient_module
            .or_else(|| types.resolve_module_name(source.bytes()).and_then(|source_file| source_file.symbol()));
        let Some(source_file_symbol) = source_file_symbol else {
            return;
        };
        let source_file_type = source_file_symbol.get_type();
        // All the exports that were values originally are listed, but one that the module has only
        // through `export type *` cannot be looked up.
        let is_there_any_exported_value = source_file_type
            .get_properties()
            .iter()
            .any(|property| source_file_type.get_property(property.escaped_name()).is_some());
        if is_there_any_exported_value {
            return;
        }
        cx.report(place_of_all(node, cx), TYPE_OVER_VALUE).fix(|fixer| {
            // tsgolint also fixes the export of a `declare module "name";`, which has no body to say what it exports.
            if is_oxlint && source_file_type.flags().intersects(TypeFlags::ANY) {
                return None;
            }
            let asterisk_token = fixer.file().tokens_in(node).find(|token| token.is_punctuator("*"))?;
            Some(fixer.insert_before(asterisk_token, "type "))
        });
    }

    fn check_export_named<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ExportNamed(export) = node.kind() else {
            return;
        };
        // It is valid to export values as types.
        if export.is_type_only() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let is_type_based = |specifier: ExportSpec<'a>| {
            !specifier.is_type_only() && is_specifier_type_based(specifier, is_oxlint) == Some(true)
        };
        if !export.items().iter().any(is_type_based) {
            return;
        }

        let mut report = ReportValueExport {
            inline_type_specifiers: Vec::new(),
            type_based_specifiers: Vec::new(),
            value_specifiers: Vec::new(),
            type_specifiers: Vec::new(),
            value_or_unresolved_specifiers: Vec::new(),
        };
        for specifier in export.items() {
            if specifier.is_type_only() {
                report.inline_type_specifiers.push(specifier);
                if is_oxlint {
                    report.type_specifiers.push(specifier);
                }
                continue;
            }
            let is_type_based = is_specifier_type_based(specifier, is_oxlint);
            match is_type_based {
                Some(true) => report.type_based_specifiers.push(specifier),
                Some(false) => report.value_specifiers.push(specifier),
                None => {}
            }
            if is_oxlint {
                match is_type_based {
                    Some(true) => report.type_specifiers.push(specifier),
                    _ => report.value_or_unresolved_specifiers.push(specifier),
                }
            }
        }

        if report.value_specifiers.is_empty() {
            cx.report(place_of_all(node, cx), TYPE_OVER_VALUE).fix(|fixer| match is_oxlint {
                true => fix_replace_named_exports(fixer, export, &report),
                false => fix_export_insert_type(fixer, export),
            });
            return;
        }

        // tsgolint names them as they are written, `a as b`, and has a comma before the `and`.
        let name_of = |specifier: &ExportSpec<'a>| {
            let mut name = Vec::new();
            match is_oxlint {
                true => push_specifier_text(&mut name, cx.file(), *specifier),
                false => name.extend_from_slice(specifier.local().bytes()),
            }
            name
        };
        let all_export_names: Vec<Vec<u8>> = report.type_based_specifiers.iter().map(name_of).collect();
        let export_names = match all_export_names.split_last() {
            Some((last, others)) if is_oxlint && others.len() > 1 => {
                [&others.join(&b", "[..])[..], &b", and "[..], &last[..]].concat()
            }
            _ => format_word_list(&all_export_names),
        };
        let message = match all_export_names.len() {
            1 => SINGLE_EXPORT_IS_TYPE,
            _ => MULTIPLE_EXPORTS_ARE_TYPES,
        };
        // oxlint points at the first of them.
        let place = match report.type_based_specifiers.first().filter(|_| cx.language().is_oxlint) {
            Some(specifier) => specifier.span(),
            None => node.span(),
        };
        let labels = |labels: &mut Details| {
            if all_export_names.len() < 2 {
                return;
            }
            for (i, (specifier, name)) in report.type_based_specifiers.iter().zip(&all_export_names).enumerate() {
                let name = bstr::BStr::new(name);
                let text = format!("{name} is a type export, try `type {name}`");
                match i {
                    0 => labels.first(text),
                    _ => labels.push(specifier.span(), text),
                }
            }
        };
        cx.report(place, message).data("exportNames", export_names).labels_with(labels).fix(|fixer| {
            if self.fix_mixed_exports_with_inline_type_specifier {
                return Some(fix_add_type_specifier_to_named_exports(fixer, &report));
            }
            match is_oxlint {
                true => fix_replace_named_exports(fixer, export, &report),
                false => fix_separate_named_exports(fixer, export, &report),
            }
        });
    }
}

impl Rule for ConsistentTypeExports {
    const META: Meta = Meta::typescript("consistent-type-exports", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types()
        .reports_at_the_end();
    const ON: On = On::new().stmts(&[StmtTag::ExportStar, StmtTag::ExportNamed]);
    no_state!();

    fn new(options: &Options) -> Self {
        ConsistentTypeExports {
            fix_mixed_exports_with_inline_type_specifier: options
                .object(0)
                .bool_or("fixMixedExportsWithInlineTypeSpecifier", false),
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::ExportStar => self.check_export_all(stmt, cx),
            StmtTag::ExportNamed => self.check_export_named(stmt, cx),
            _ => {}
        }
    }
}
