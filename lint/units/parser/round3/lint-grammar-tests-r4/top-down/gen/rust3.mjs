// Writes ../grammar_rows_tests.rs.draft: the tables and the tests that replace the four typescript-grammar*.test.ts files.
// The draft was never compiled. Run rustfmt on it after it is copied to src/js_parser/parse/grammar_rows_tests.rs.
// usage: node rust.mjs [family ...]     (reads ../rows.facts.json)
// The families named are those a lint parse does not read: they go into NOT_READ, and the table and a fifth test get what a parse
// without lint makes of each source. Without a family the file has four tests and no such column.
import { readFileSync, writeFileSync } from "node:fs";
import { ts } from "./roots.mjs";
import { FAMILIES, familyOf } from "./families.mjs";
const here = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(here + "rows.facts2.json", "utf8"));
const FACTS_ALL = process.argv.includes("--facts=all");
const RECORDS = process.argv.includes("--records");
const OUT = (process.argv.find(a => a.startsWith("--out=")) ?? "--out=grammar_rows_tests.rs.draft").slice(6);
const notRead = process.argv.slice(2).filter(a => !a.startsWith("--"));
// --as-without-lint=<case,case,...>: the sources of these cases get what main makes of them (../runs/main.*.json through rows.facts2.json).
const asWithoutLint = new Set((process.argv.find(a => a.startsWith("--as-without-lint=")) ?? "--as-without-lint=").slice(18).split(",").filter(Boolean).map(Number));
for (const f of notRead) if (!FAMILIES[f]) throw new Error("no family " + f);

const STATEMENT = { [ts.SyntaxKind.VariableStatement]: "s_local", [ts.SyntaxKind.ExpressionStatement]: "s_expr", [ts.SyntaxKind.FunctionDeclaration]: "s_function", [ts.SyntaxKind.ClassDeclaration]: "s_class", [ts.SyntaxKind.Block]: "s_block", [ts.SyntaxKind.ImportDeclaration]: "s_import" };
const bytes = text => 'b"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const str = text => '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const list = items => (items.length === 0 ? "&[]" : "&[" + items.map(str).join(", ") + "]");
const DIALECT = { ts: "Ts", tsx: "Tsx", js: "Js", deco: "Decorators" };

// The type roots of the rows of the classes T and M: the text from the root to the end of the source, its outline, and where the next token starts.
const typeTables = { type: new Map(), return: new Map(), "type-parameters": new Map() };
for (const r of rows) {
  if (r.reject || (r.class !== "T" && r.class !== "M")) continue;
  const loader = r.loader === "deco" ? "ts" : r.loader;
  const add = (entry, start, end, outline) => {
    const rest = r.src.slice(start);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, r.src);
    scanner.setTextPos(end);
    const next = (scanner.scan() === ts.SyntaxKind.EndOfFileToken ? r.src.length : scanner.getTokenStart()) - start;
    if (!typeTables[entry].has(rest)) typeTables[entry].set(rest, { outline, next, rows: [] });
    const e = typeTables[entry].get(rest);
    if (e.outline !== outline || e.next !== next) throw new Error("two readings of " + rest);
    e.rows.push(r.i);
  };
  for (const root of r.roots) {
    if (root.entry === "type" || root.entry === "return") add(root.entry, root.start, root.end, root.outline);
    else if (root.entry === "type-parameters") {
      const t = typeTables["type-parameters"];
      if (!t.has(root.text)) t.set(root.text, { outline: root.outline, closeEnd: root.closeEnd, rows: [] });
      t.get(root.text).rows.push(r.i);
    }
  }
}
// A heritage entry is read with its class or interface: its type arguments are read alone.
// (The roots of roots.mjs hold them inside the ExpressionWithTypeArguments; `(a = 1) => void` is in the table from other rows.)

// What a parse without lint keeps of a source that it accepts: one tag for each statement of its output.
const keptOfOutput = text => text.split("\n").filter(Boolean).map(line => (/^(export )?(const|let|var) /.test(line) ? "s_local" : "s_expr"));

const seen = new Map();
for (const r of rows) {
  const key = r.loader + "\0" + r.src;
  if (seen.has(key)) { seen.get(key).rows.push(r.i); continue; }
  const family = familyOf(r);
  const asMain = () => {
    if (r.main[0] === "e") {
      const [text, line, column] = r.main[1][0];
      const offset = r.src.split("\n").slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
      return `Want::AsWithoutLint(Err((${bytes(text)}, ${offset})))`;
    }
    if (r.key) return `Want::AsWithoutLint(Ok(${list(r.facts.kept)}))`;
    const program = ts.createSourceFile("/o.js", r.main[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return `Want::AsWithoutLint(Ok(${list(program.statements.map(st => STATEMENT[st.kind] ?? (() => { throw new Error("no tag for " + ts.SyntaxKind[st.kind]); })()))}))`;
  };
  let want;
  if (asWithoutLint.has(r.i)) want = asMain();
  else if (r.reject) want = `Want::Fails(${r.reject.code}, ${r.reject.start}, ${r.reject.end})`;
  else if (!FACTS_ALL && (r.class === "T" || r.class === "M")) want = "Want::Parses";
  else {
    const f = r.facts;
    want = `Want::Reads(${str(`kept[${f.kept.join(" ")}] erased[${f.erased.join(" | ")}] wrappers[${f.wrappers.join(" | ")}] nodes[${f.nodes}] enums[${f.enums.join(" | ")}] returns[${f.returns}]` + (RECORDS ? ` types[${f.types.join(" | ")}] return_types[${f.returnTypes.join(" | ")}] type_parameters[${f.typeParameters.join(" | ")}] heritage[${f.heritage.join(" | ")}]` : ""))})`;
  }
  let without;
  if (r.main[0] === "e") without = "None";
  else if (r.class === "M") without = `Some(${list(r.facts.kept)})`;
  else without = `Some(${list(keptOfOutput(r.main[1]))})`;
  seen.set(key, { family, dialect: DIALECT[r.loader], text: r.src, want, without, rows: [r.i] });
}

const out = [];
const emit = line => out.push(line);
emit(`//! The sources of the tests that the type grammar had for a parse without lint, read by a lint parse: each expectation is what tsc 6.0.2 builds for the source.

use bun_alloc::Arena;
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprTag, G, Loader, Loc, S, ts};

use super::erased_tests;
use super::parse_entry::{Options, ParsedForLint, Parser};
use super::syntax_errors::SyntaxErrors;
use super::wrappers::Wrapper;
use crate::defines::Define;
use crate::type_sink_tests::{read_from, type_parameters_read, type_read};

/// Whether the line of a source holds the types of the side table.
const RECORDS: bool = ${RECORDS};

/// How a source is read: its loader, and with \`Decorators\` the decorators of TypeScript and their metadata.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Dialect {
    Ts,
    Tsx,
    Js,
    Decorators,
}

enum Want {
    /// tsc parses the source.
    Parses,
    /// tsc parses the source and reads this outside its types: the line that \`facts\` makes.
    Reads(&'static str),
    /// tsc rejects the source: the code, the start and the end of its first diagnostic.
    Fails(u32, u32, u32),
    /// The site of the source has no branch for a lint parse: what a parse without lint makes of it, the text and the offset of its first error or the tag of each statement it keeps.
    AsWithoutLint(Result<&'static [&'static str], (&'static [u8], usize)>),
}

/// The first error of a lint parse that fails: the code, the start and the end of its entry, zeros where it has none, and the text and the offset of its message.
struct Failure {
    entry: (u32, u32, u32),
    text: String,
    offset: usize,
}

/// What a lint parse made of a source, for the message of a test that fails.
fn said(found: &Result<String, Failure>) -> String {
    match found {
        Ok(line) => line.clone(),
        Err(failure) => {
            let (code, start, end) = failure.entry;
            let (text, offset) = (&failure.text, failure.offset);
            format!("TS{code} [{start},{end}), the message at {offset}: {text}")
        }
    }
}

struct Row {
    /// The change of the grammar that the source shows.
    family: &'static str,
    dialect: Dialect,
    text: &'static [u8],
    want: Want,
    /// What a parse without lint makes of the source: \`None\` where it fails, else the tag of each statement it keeps.
    without_lint: Option<&'static [&'static str]>,
}

/// The families that a lint parse reads as a parse without lint does: their sites have no place for a lint parse to branch at.
const NOT_READ: &[&str] = &[];

/// What \`check\` makes of the lint parse of \`text\`, or its first error.
fn lint_parse<R>(
    dialect: Dialect,
    text: &'static [u8],
    check: impl FnOnce(&ParsedForLint<'_, '_>) -> R,
) -> Result<R, Failure> {
    let (path, loader): (&'static [u8], Loader) = match dialect {
        Dialect::Ts | Dialect::Decorators => (b"/a.ts", Loader::Ts),
        Dialect::Tsx => (b"/a.tsx", Loader::Tsx),
        Dialect::Js => (b"/a.js", Loader::Js),
    };
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.standard_decorators = dialect != Dialect::Decorators;
    options.features.emit_decorator_metadata = dialect == Dialect::Decorators;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let mut errors = SyntaxErrors::default();
    if let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena)
        && let Ok(found) = parser.parse_for_lint_with_codes(&mut errors, check)
    {
        return Ok(found);
    }
    let first = log.msgs.iter().position(|msg| msg.kind == bun_ast::Kind::Err);
    let entry = first.and_then(|first| errors.get(first));
    let message = first.and_then(|first| log.msgs.get(first));
    Err(Failure {
        entry: entry.map_or((0, 0, 0), |entry| (entry.code, entry.start, entry.end)),
        text: message.map_or_else(String::new, |msg| bstr::BStr::new(&*msg.data.text).to_string()),
        offset: message
            .and_then(|msg| msg.data.location.as_ref())
            .map_or(0, |location| location.offset),
    })
}

/// The line of a wrapper record, as the tests of \`wrappers\` print it.
fn wrapper_line(record: &Wrapper) -> String {
    let kind = record.data.kind_name();
    let (op, end) = (record.op, record.end);
    let type_node = record.type_node().map(described).unwrap_or_default();
    let tag = <&'static str>::from(record.operand.data.tag());
    let start = record.operand.loc.start;
    format!("{kind} [{op},{end}){type_node} of {tag}@{start}")
}

fn described(type_node: ts::Type) -> String {
    let kind = type_node.data.kind_name();
    let name = match type_node.data {
        ts::TypeData::TypeReference(reference) => match reference.type_name {
            ts::EntityName::Identifier(name) => format!("({})", bstr::BStr::new(name.text.slice())),
            ts::EntityName::QualifiedName(_) => String::new(),
        },
        _ => String::new(),
    };
    format!(" {kind}{name}[{},{})", type_node.start, type_node.end)
}

/// The nodes of the statements that stay which the rows are about.
struct Nodes<'r, 'p, 'a> {
    parsed: &'r ParsedForLint<'p, 'a>,
    found: Vec<(i32, &'static str)>,
    enums: Vec<String>,
}

impl Nodes<'_, '_, '_> {
    fn accessors(&mut self, class: &G::Class) {
        for property in class.properties.slice() {
            if property.kind == G::PropertyKind::AutoAccessor {
                let start = property.key.map_or(-1, |key| key.loc.start);
                self.found.push((start, "auto_accessor"));
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Nodes<'_, '_, '_> {
    fn enter_expr(&mut self, expr: &'ast Expr) {
        let tag = expr.data.tag();
        if matches!(
            tag,
            ExprTag::EIf | ExprTag::EArrow | ExprTag::ECall | ExprTag::EImport | ExprTag::EImportMeta
        ) {
            self.found.push((expr.loc.start, tag.into()));
        }
    }

    fn visit_s_class(&mut self, node: &'ast S::Class, _loc: Loc) {
        self.accessors(&node.class);
        walk::walk_s_class(self, node);
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _loc: Loc) {
        self.accessors(node);
        walk::walk_e_class(self, node);
    }

    fn visit_s_enum(&mut self, node: &'ast S::Enum, _loc: Loc) {
        let name = bstr::BStr::new(self.parsed.name_of(node.name.ref_));
        let members: Vec<String> = node
            .values
            .slice()
            .iter()
            .map(|value| bstr::BStr::new(value.name.slice()).to_string())
            .collect();
        self.enums.push(format!("{name}={}", members.join(",")));
        walk::walk_s_enum(self, node);
    }
}

/// One line of what a lint parse shows beside the types: statements that stay, dropped records, wrappers, nodes by offset, enums, return types.
fn rendered(
    kept: &[&str],
    erased: &[String],
    wrappers: &[String],
    nodes: &str,
    enums: &[String],
    returns: usize,
) -> String {
    format!(
        "kept[{}] erased[{}] wrappers[{}] nodes[{nodes}] enums[{}] returns[{returns}]",
        kept.join(" "),
        erased.join(" | "),
        wrappers.join(" | "),
        enums.join(" | "),
    )
}

/// The tag of each statement that the file keeps.
fn kept(parsed: &ParsedForLint<'_, '_>) -> Vec<&'static str> {
    parsed.stmts.iter().map(|stmt| stmt.data.tag().into()).collect()
}

/// What the lint parse shows of the source: the conditionals, arrow functions, calls, \`import()\`, \`import.meta\` and auto-accessors are the nodes.
fn facts(parsed: &ParsedForLint<'_, '_>) -> String {
    let mut nodes = Nodes {
        parsed,
        found: Vec::new(),
        enums: Vec::new(),
    };
    for stmt in parsed.stmts {
        nodes.visit_stmt(stmt);
    }
    nodes.found.sort();
    let found: Vec<String> = nodes
        .found
        .iter()
        .map(|(start, tag)| format!("{tag}@{start}"))
        .collect();
    let wrappers: Vec<String> = parsed.sidecar.wrappers.records.iter().map(wrapper_line).collect();
    let line = rendered(
        &kept(parsed),
        &erased_tests::describe(parsed),
        &wrappers,
        &found.join(" "),
        &nodes.enums,
        parsed.sidecar.attached.return_types.len(),
    );
    if !RECORDS {
        return line;
    }
    format!("{line} {}", records(parsed))
}

/// The outline of a type, as the tests of the sink print it.
fn outlined(node: ts::Type) -> String {
    let mut lines = Vec::new();
    crate::type_sink_tests::outline(node, &mut lines);
    lines.join(" ")
}

/// The types that the side table keeps for the nodes that stay: annotations, return types, type parameters and heritage clauses, each list by offset.
fn records(parsed: &ParsedForLint<'_, '_>) -> String {
    let attached = &parsed.sidecar.attached;
    let mut types: Vec<(u32, String)> = attached
        .annotations
        .iter()
        .filter_map(|record| record.type_node)
        .map(|node| (node.start, outlined(node)))
        .collect();
    types.sort();
    let mut return_types: Vec<(u32, String)> = attached
        .return_types
        .iter()
        .map(|record| (record.type_node.start, outlined(record.type_node)))
        .collect();
    return_types.sort();
    let mut type_parameters: Vec<(u32, String)> = attached
        .type_parameters
        .iter()
        .map(|record| {
            let list = record.list;
            let mut line = format!("<{},{}>{{{},{}}}", record.lt, record.end, list.start, list.end);
            for parameter in list.iter() {
                let name = bstr::BStr::new(parameter.name.text.slice());
                line.push_str(&format!(" {name}[{},{})", parameter.start, parameter.end));
            }
            (record.lt, line)
        })
        .collect();
    type_parameters.sort();
    let mut heritage: Vec<(u32, String)> = Vec::new();
    for record in &attached.heritage {
        let token = match record.clause.token {
            ts::HeritageToken::Extends => "extends",
            ts::HeritageToken::Implements => "implements",
        };
        for &node in record.clause.types.iter() {
            heritage.push((node.start, format!("{token}: {}", outlined(node))));
        }
    }
    heritage.sort();
    let join = |list: Vec<(u32, String)>| {
        let lines: Vec<String> = list.into_iter().map(|(_, line)| line).collect();
        lines.join(" | ")
    };
    format!(
        "types[{}] return_types[{}] type_parameters[{}] heritage[{}]",
        join(types),
        join(return_types),
        join(type_parameters),
        join(heritage)
    )
}

#[test]
fn a_type_of_a_row_is_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for &(text, expected, next) in TYPES {
        let found = type_read(text).map(|(outline, errors, _, start)| (outline, errors, start));
        if found != Some((expected.to_owned(), 0, next)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn a_return_type_of_a_row_is_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for &(text, expected, next) in RETURN_TYPES {
        let found = read_from(text, |p| p.build_typescript_return_type())
            .map(|(outline, errors, _, start)| (outline, errors, start));
        if found != Some((expected.to_owned(), 0, next)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn the_type_parameters_of_a_row_end_at_their_closer() {
    for &(text, expected, close_end) in TYPE_PARAMETERS {
        let found = type_parameters_read(text);
        let expected = Some((expected.to_owned(), close_end));
        assert_eq!(found, expected, "{}", bstr::BStr::new(text));
    }
}

#[test]
fn a_lint_parse_reads_a_row_as_tsc_does() {
    let mut failed = Vec::new();
    for row in ROWS.iter().filter(|row| !NOT_READ.contains(&row.family)) {
        let found = lint_parse(row.dialect, row.text, facts);
        let passed = match (&row.want, &found) {
            (Want::Parses, Ok(_)) => true,
            (Want::Reads(want), Ok(found)) => found == want,
            (Want::Fails(code, start, end), Err(found)) => found.entry == (*code, *start, *end),
            (Want::AsWithoutLint(Err((text, offset))), Err(found)) => {
                found.text.as_bytes() == *text && found.offset == *offset
            }
            (Want::AsWithoutLint(Ok(tags)), Ok(found)) => {
                found.starts_with(&format!("kept[{}] ", tags.join(" ")))
            }
            _ => false,
        };
        if !passed {
            failed.push(format!(
                "{} {:?} {}: {}",
                row.family,
                row.dialect,
                bstr::BStr::new(row.text),
                said(&found)
            ));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn a_lint_parse_reads_a_row_of_a_site_without_a_route_as_a_parse_without_lint_does() {
    let mut failed = Vec::new();
    for row in ROWS.iter().filter(|row| NOT_READ.contains(&row.family)) {
        let found = lint_parse(row.dialect, row.text, kept).ok();
        if found.as_deref() != row.without_lint {
            failed.push(format!("{} {:?} {}: {found:?}", row.family, row.dialect, bstr::BStr::new(row.text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}
`);
emit(`/// Each text starts with a type of a row and goes on to the end of its source: the outline of the type, and where the token after it starts.`);
emit(`#[rustfmt::skip]`);
emit(`const TYPES: &[(&[u8], &str, usize)] = &[`);
for (const [rest, e] of typeTables.type) emit(`    (${bytes(rest)}, ${str(e.outline)}, ${e.next}),`);
emit(`];\n`);
emit(`/// The same for what follows the \`:\` after a parameter list.`);
emit(`#[rustfmt::skip]`);
emit(`const RETURN_TYPES: &[(&[u8], &str, usize)] = &[`);
for (const [rest, e] of typeTables.return) emit(`    (${bytes(rest)}, ${str(e.outline)}, ${e.next}),`);
emit(`];\n`);
emit(`/// The type parameter lists of the rows: the range of the list, the name and the range of each type parameter, and the offset after the \`>\`.`);
emit(`#[rustfmt::skip]`);
emit(`const TYPE_PARAMETERS: &[(&[u8], &str, u32)] = &[`);
for (const [text, e] of typeTables["type-parameters"]) emit(`    (${bytes(text)}, ${str(e.outline)}, ${e.closeEnd}),`);
emit(`];\n`);
emit(`/// Every source of the rows, once for each way it was read.`);
emit(`#[rustfmt::skip]`);
emit(`const ROWS: &[Row] = &[`);
for (const row of seen.values()) emit(`    Row { family: ${str(row.family)}, dialect: Dialect::${row.dialect}, text: ${bytes(row.text)}, want: ${row.want}, without_lint: ${row.without} },`);
emit(`];`);
let text = out.join("\n") + "\n";
if (notRead.length === 0) {
  // No family is left out: no column, no constant, no fifth test.
  const drop = (from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error("no " + from); text = text.slice(0, a) + text.slice(b); };
  drop("    /// What a parse without lint makes of the source:", "}\n\n/// The families that a lint parse reads");
  drop("/// The families that a lint parse reads", "/// What `check` makes of the lint parse");
  drop("#[test]\nfn a_lint_parse_reads_a_row_of_a_site_without_a_route_as_a_parse_without_lint_does", "/// Each text starts with a type of a row");
  text = text.replace("    for row in ROWS.iter().filter(|row| !NOT_READ.contains(&row.family)) {", "    for row in ROWS {");
  text = text.replace(/, without_lint: (None|Some\(&\[[^\]]*\]\)) \},\n/g, " },\n");
} else {
  text = text.replace("const NOT_READ: &[&str] = &[];", `const NOT_READ: &[&str] = &[${notRead.map(str).join(", ")}];`);
}
if (![...seen.values()].some(row => row.want === "Want::Parses")) {
  // No row is left with the bare expectation: the variant and its arm go.
  for (const gone of ["    /// tsc parses the source.\n    Parses,\n", "            (Want::Parses, Ok(_)) => true,\n"]) {
    if (!text.includes(gone)) throw new Error("no " + gone);
    text = text.replace(gone, "");
  }
}
if (![...seen.values()].some(row => row.want.startsWith("Want::AsWithoutLint"))) {
  const from = text.indexOf("    /// The site of the source has no branch for a lint parse:");
  const to = text.indexOf("}\n", from);
  if (from < 0 || to < 0) throw new Error("no variant AsWithoutLint");
  text = text.slice(0, from) + text.slice(to);
  const arms = text.indexOf("            (Want::AsWithoutLint(Err((text, offset))), Err(found)) => {");
  const after = text.indexOf("            _ => false,", arms);
  if (arms < 0 || after < 0) throw new Error("no arms of AsWithoutLint");
  text = text.slice(0, arms) + text.slice(after);
}
writeFileSync(here + OUT, text);
const wants = { Parses: 0, Reads: 0, Fails: 0, AsWithoutLint: 0 };
for (const row of seen.values()) wants[/^Want::(\w+)/.exec(row.want)[1]]++;
console.log(`${OUT}: ${typeTables.type.size} types, ${typeTables.return.size} return types, ${typeTables["type-parameters"].size} type parameter lists, ${seen.size} sources (${JSON.stringify(wants)}) of ${rows.length} rows`);
