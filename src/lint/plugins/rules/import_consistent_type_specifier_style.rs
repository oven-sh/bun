use bun_lint_oxlint::codegen::print_string;
use bun_lint_oxlint::text::{file_name, find_next_token_within};
use bun_core::strings;
use bun_lint::fix::IntoFix;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Enforce or ban the use of inline type-only markers for named imports.
pub struct ConsistentTypeSpecifierStyle(Mode);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    TopLevel,
    Inline,
    TopLevelIfOnlyTypeImports,
}

const USE_TOP_LEVEL_FOR_DECLARATION_FILE_IMPORT: Message =
    Message::new("", "Type imports from declaration files must use top-level `import type` syntax.");
// The plugin's `{{kind}}` is `type`: the `typeof` of Flow is not read here.
const INLINE: Message = Message::new("", "Prefer using inline type specifiers instead of a top-level type-only import.");
const TOP_LEVEL: Message = Message::new("", "Prefer using a top-level type-only import instead of inline type specifiers.");
const TOP_LEVEL_IF_ONLY_TYPE_IMPORTS: Message = Message::new(
    "",
    "Prefer using a top-level type-only import instead of inline type specifiers when there are only type imports.",
);

impl Rule for ConsistentTypeSpecifierStyle {
    const META: Meta = Meta::plugin(Plugin::Import, "consistent-type-specifier-style", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTypeSpecifierStyle(match options.str(0) {
            Some("prefer-inline") => Mode::Inline,
            Some("prefer-top-level-if-only-type-imports") => Mode::TopLevelIfOnlyTypeImports,
            _ => Mode::TopLevel,
        })
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let language = file.language();
        // oxlint goes by the name of the file. In the tree of espree nothing is a type.
        let can_have_types = if language.is_oxlint { !file.is_javascript() } else { language.parser != Parser::Espree };
        can_have_types.then_some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        let (mode, named, is_oxlint) = (self.0, import.named(), cx.language().is_oxlint);
        if named.is_empty() {
            return;
        }
        // oxlint wants `import type` for a declaration file, whatever the option.
        let is_declaration_file_import = || is_oxlint && is_declaration_file_import(import.spec().bytes());
        if import.is_type_only() {
            if mode == Mode::Inline && !is_declaration_file_import() {
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
        let is_declaration_file_import = is_declaration_file_import();
        let has_values = || import.default().is_some() || named.iter().any(|it| !it.is_type_only());
        let should_use_top_level =
            is_declaration_file_import || mode == Mode::TopLevel || mode == Mode::TopLevelIfOnlyTypeImports && !has_values();
        if !should_use_top_level {
            return;
        }
        let fix = |fixer: Fixer<'a>| if is_oxlint { Some(print_anew(fixer, import)) } else { move_types_out(fixer, import) };
        // The plugin reports a statement that has nothing but inline types once, oxlint with the option of its own.
        let is_one_report =
            if is_oxlint { mode == Mode::TopLevelIfOnlyTypeImports && !is_declaration_file_import } else { !has_values() };
        if is_one_report {
            cx.report(stmt, if is_oxlint { TOP_LEVEL_IF_ONLY_TYPE_IMPORTS } else { TOP_LEVEL }).fix(fix);
            return;
        }
        let message = if is_declaration_file_import { USE_TOP_LEVEL_FOR_DECLARATION_FILE_IMPORT } else { TOP_LEVEL };
        let mut made = None;
        for item in named.iter().filter(|it| it.is_type_only()) {
            cx.report(item, message).fix(|fixer| made.get_or_insert_with(|| fix(fixer)).clone());
        }
    }
}

/// The fix of the plugin: the inline types leave the statement, and an `import type` of them comes after it.
#[cold]
#[inline(never)]
fn move_types_out<'a>(fixer: Fixer<'a>, import: Import<'a>) -> Option<Fix> {
    let (file, stmt, named) = (fixer.file(), import.stmt(), import.named());
    // upstream's `getImportText`
    let mut new_import = b"\nimport type {".to_vec();
    for (index, specifier) in named.iter().filter(|it| it.is_type_only()).enumerate() {
        let (imported, local) = (specifier.imported(), specifier.local());
        new_import.extend_from_slice(if index == 0 { "" } else { ", " }.as_bytes());
        // It asks for the `name` of what is written as a string.
        new_import.extend_from_slice(if imported.is_string() { &b"undefined"[..] } else { imported.bytes() });
        if imported.is_string() || imported.name() != local.name() {
            new_import.extend_from_slice(b" as ");
            new_import.extend_from_slice(local.bytes());
        }
    }
    new_import.extend_from_slice(b"} from ");
    new_import.extend_from_slice(file.slice(import.spec_span()?));
    new_import.push(b';');
    let comma_after = |it: ImportSpec<'a>| Some(fixer.remove(file.token_after(it).filter(|it| it.is_punctuator(","))?));
    let mut fixes = Vec::new();
    match (named.iter().rfind(|it| !it.is_type_only()), import.default()) {
        (None, None) => return Some(fixer.replace(stmt, new_import.get(1..)?)),
        (Some(last_value), _) => {
            for specifier in named.iter().filter(|it| it.is_type_only()) {
                fixes.extend(comma_after(specifier));
                fixes.push(fixer.remove(specifier));
            }
            fixes.extend(comma_after(last_value));
        }
        (None, Some(default)) => {
            let comma = file.tokens_after(default).find(|it| it.is_punctuator(","))?;
            let closing_brace = file.tokens_after(named.last()?).find(|it| it.is_punctuator("}"))?;
            fixes.push(fixer.remove(Span::new(comma.start(), closing_brace.end())));
        }
    }
    fixes.push(fixer.insert_after(stmt, new_import));
    fixes.into_fix(file)
}

/// The fix of oxlint: the statement is printed anew, as one of the values and one of the types.
#[cold]
#[inline(never)]
fn print_anew(fixer: Fixer, import: Import) -> Fix {
    let (types, values): (Specifiers, Specifiers) = import.named().iter().partition(|it| it.is_type_only());
    let mut import_source = Vec::new();
    if import.default().is_some() || !values.is_empty() {
        gen_import_declaration(import, import.default(), &values, false, &mut import_source);
        import_source.push(b'\n');
    }
    gen_import_declaration(import, None, &types, true, &mut import_source);
    fixer.replace(import.stmt(), import_source)
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
