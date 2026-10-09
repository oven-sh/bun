use bun_lint_oxlint::codegen::print_string;
use bun_lint_oxlint::text::{file_name, find_next_token_within};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Enforces or bans the use of inline type-only markers for named imports.
pub struct ConsistentTypeSpecifierStyle(Mode);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    TopLevel,
    Inline,
    TopLevelIfOnlyTypeImports,
}

const USE_TOP_LEVEL_FOR_DECLARATION_FILE_IMPORT: Message =
    Message::new("", "Type imports from declaration files must use top-level `import type` syntax.");
const INLINE: Message = Message::new("", "Prefer using inline type specifiers instead of a top-level type-only import.");
const TOP_LEVEL: Message = Message::new("", "Prefer using a top-level type-only import instead of inline type specifiers.");
const TOP_LEVEL_IF_ONLY_TYPE_IMPORTS: Message = Message::new(
    "",
    "Prefer using a top-level type-only import instead of inline type specifiers when there are only type imports.",
);

impl Rule for ConsistentTypeSpecifierStyle {
    const META: Meta = Meta::oxlint(Plugin::Import, "consistent-type-specifier-style", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTypeSpecifierStyle(match options.str(0) {
            Some("prefer-inline") => Mode::Inline,
            Some("prefer-top-level-if-only-type-imports") => Mode::TopLevelIfOnlyTypeImports,
            _ => Mode::TopLevel,
        })
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.is_javascript() {
            on.stmts([StmtTag::Import], Self::check);
        }
    }
}

impl ConsistentTypeSpecifierStyle {
    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        let (mode, named) = (self.0, import.named());
        if named.is_empty() {
            return;
        }
        if import.is_type_only() {
            if mode == Mode::Inline && !is_declaration_file_import(import.spec().bytes()) {
                cx.report(stmt, INLINE).fix(|fixer| {
                    let mut fixes: Vec<Fix> = named.iter().map(|it| fixer.insert_before(it, "type ")).collect();
                    let keyword = find_next_token_within(fixer.file(), stmt.span(), b"type");
                    fixes.extend(keyword.map(|at| fixer.remove(Span::new(at, at + 4))));
                    fixes
                });
            }
            return;
        }
        if !named.iter().any(ImportSpec::is_type_only) {
            return;
        }
        let is_declaration_file_import = is_declaration_file_import(import.spec().bytes());
        let has_values = || import.default().is_some() || named.iter().any(|it| !it.is_type_only());
        let should_use_top_level =
            is_declaration_file_import || mode == Mode::TopLevel || mode == Mode::TopLevelIfOnlyTypeImports && !has_values();
        if !should_use_top_level {
            return;
        }
        let fix = |fixer: Fixer<'a>| {
            let (types, values): (Specifiers, Specifiers) = named.iter().partition(|it| it.is_type_only());
            let mut import_source = Vec::new();
            if import.default().is_some() || !values.is_empty() {
                gen_import_declaration(import, import.default(), &values, false, &mut import_source);
                import_source.push(b'\n');
            }
            gen_import_declaration(import, None, &types, true, &mut import_source);
            fixer.replace(stmt, import_source)
        };
        if mode == Mode::TopLevelIfOnlyTypeImports && !is_declaration_file_import {
            cx.report(stmt, TOP_LEVEL_IF_ONLY_TYPE_IMPORTS).fix(fix);
            return;
        }
        // Each fix is the whole statement anew, and only one of them can be applied: of a long statement only the first has it.
        let is_short = stmt.span().len() <= 1024;
        let message = if is_declaration_file_import { USE_TOP_LEVEL_FOR_DECLARATION_FILE_IMPORT } else { TOP_LEVEL };
        for (index, item) in named.iter().filter(|it| it.is_type_only()).enumerate() {
            let report = cx.report(item, message);
            if is_short || index == 0 {
                report.fix(fix);
            }
        }
    }
}

type Specifiers<'a> = SmallVec<[ImportSpec<'a>; 8]>;

fn print_module_export_name(name: Ident, out: &mut Vec<u8>) {
    match name.is_string() {
        true => print_string(out, name.bytes(), b'\''),
        false => out.extend_from_slice(name.bytes()),
    }
}

/// What `oxc_codegen` prints for an import of `default` and `named` from the module of `import`, with its attributes.
fn gen_import_declaration(import: Import, default: Option<Ident>, named: &[ImportSpec], is_type: bool, out: &mut Vec<u8>) {
    out.extend_from_slice(if is_type { "import type " } else { "import " }.as_bytes());
    if let Some(default) = default {
        out.extend_from_slice(default.bytes());
        out.extend_from_slice(if named.is_empty() { " " } else { ", " }.as_bytes());
    }
    for (index, specifier) in named.iter().enumerate() {
        out.extend_from_slice(if index == 0 { "{ " } else { ", " }.as_bytes());
        print_module_export_name(specifier.imported(), out);
        if specifier.imported().name() != specifier.local().name() {
            out.extend_from_slice(b" as ");
            out.extend_from_slice(specifier.local().bytes());
        }
    }
    out.extend_from_slice(if named.is_empty() { "from " } else { " } from " }.as_bytes());
    print_string(out, import.spec().bytes(), b'\'');
    if let Some(attributes) = import.attributes() {
        out.push(b' ');
        out.extend_from_slice(import.stmt().file().slice(attributes.keyword_span()));
        out.extend_from_slice(b" {");
        for (index, entry) in attributes.entries().iter().enumerate() {
            out.extend_from_slice(if index == 0 { " " } else { ", " }.as_bytes());
            match entry.key().map(Key::kind) {
                Some(KeyKind::String(key)) => print_string(out, key.bytes(), b'\''),
                Some(KeyKind::Ident(key)) => out.extend_from_slice(key.bytes()),
                _ => {}
            }
            out.extend_from_slice(b": ");
            print_string(out, entry.value().and_then(Expr::as_string).map_or(&b""[..], Name::bytes), b'\'');
        }
        out.extend_from_slice(if attributes.entries().is_empty() { "}" } else { " }" }.as_bytes());
    }
    out.push(b';');
}

/// `./a.d.ts`, `./a.d.mts`, `./a.d.css.ts`
fn is_declaration_file_import(source: &[u8]) -> bool {
    if !strings::contains(source, b".d") {
        return false;
    }
    let file_name = file_name(source);
    match strings::rsplit_once_char(file_name, b'.') {
        Some(([_, ..], b"ts")) => strings::last_index_of(source, b".d.").is_some_and(|at| at != 0),
        Some(([_, ..], b"mts" | b"cts")) => source.len() > 6 && source.get(..source.len() - 4).is_some_and(|it| it.ends_with(b".d")),
        _ => false,
    }
}
