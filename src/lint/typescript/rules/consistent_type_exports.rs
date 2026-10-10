use bun_lint::prelude::*;
use bun_lint::types::{NameOf, SymbolFlags, TsSymbol};
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
}

/// Whether a symbol resolves to a TypeScript type and not to a JavaScript value. `None` if it
/// cannot be resolved.
fn is_symbol_type_based(symbol: Option<TsSymbol>) -> Option<bool> {
    let mut symbol = symbol?;
    // Aliases can form a cycle through other modules.
    for _ in 0..64 {
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

fn is_specifier_type_based(specifier: ExportSpec) -> Option<bool> {
    is_symbol_type_based(NameOf(specifier).ts_symbol())
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
        let types = cx.file().type_checker();
        let Some(source_file_symbol) =
            types.resolve_module_name(source.bytes()).and_then(|source_file| source_file.symbol())
        else {
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
        let is_type_based = |specifier: ExportSpec<'a>| {
            !specifier.is_type_only() && is_specifier_type_based(specifier) == Some(true)
        };
        if !export.items().iter().any(is_type_based) {
            return;
        }

        let mut report = ReportValueExport {
            inline_type_specifiers: Vec::new(),
            type_based_specifiers: Vec::new(),
            value_specifiers: Vec::new(),
        };
        for specifier in export.items() {
            if specifier.is_type_only() {
                report.inline_type_specifiers.push(specifier);
                continue;
            }
            match is_specifier_type_based(specifier) {
                Some(true) => report.type_based_specifiers.push(specifier),
                Some(false) => report.value_specifiers.push(specifier),
                None => {}
            }
        }

        if report.value_specifiers.is_empty() {
            cx.report(place_of_all(node, cx), TYPE_OVER_VALUE).fix(|fixer| fix_export_insert_type(fixer, export));
            return;
        }

        let all_export_names: Vec<&[u8]> =
            report.type_based_specifiers.iter().map(|specifier| specifier.local().bytes()).collect();
        let message = match all_export_names.len() {
            1 => SINGLE_EXPORT_IS_TYPE,
            _ => MULTIPLE_EXPORTS_ARE_TYPES,
        };
        // oxlint points at the first of them.
        let place = match report.type_based_specifiers.first().filter(|_| cx.language().is_oxlint) {
            Some(specifier) => specifier.span(),
            None => node.span(),
        };
        cx.report(place, message).data("exportNames", format_word_list(&all_export_names)).fix(|fixer| {
            match self.fix_mixed_exports_with_inline_type_specifier {
                true => Some(fix_add_type_specifier_to_named_exports(fixer, &report)),
                false => fix_separate_named_exports(fixer, export, &report),
            }
        });
    }
}

impl Rule for ConsistentTypeExports {
    const META: Meta = Meta::typescript("consistent-type-exports", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types();
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
