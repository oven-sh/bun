// usage: node families.cjs <chk.jsonl> <join.jsonl>... [--examples=N] [--list=<family id>]
// Class "TL" (the reference parses, the lint parse rejects) of the join files, by cause. A record belongs to the first family whose test holds.
// Prints one table over all the files: family, count for each file, what tsc's checker says (grammar codes), examples.
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [chkPath, ...joins] = args.filter(a => !a.startsWith("--"));
const nExamples = Number(flag("examples") ?? 2);
const chk = new Map(fs.readFileSync(chkPath, "utf8").split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return [r.src, r]; }));

const has = (s, re) => re.test(s);
// [id, title, test(record)]; record = {src, ctx, t, prod, lint: {bun, at}, ...}; t is null for the targeted corpus.
const FAMILIES = [
  ["AWAIT-NAME", "`await` as a name while top_level_await is on", r => has(r.src, /\bawait\b/) && has(r.lint.bun, /"yield" or "await"|Cannot use "await" here|^Unexpected [\]):?.]|Unexpected \.\.\.|Expected ";" but found ":"|Expected "\}" but found "await"|Invalid binding/) && r.cfgTla && !has(r.src, /await using|for await|await x/)],
  ["AWAIT-EXPR", "`await` expression outside an async function while top_level_await is off", r => has(r.lint.bun, /"await" can only be used inside an "async" function|Cannot use "await" outside an async function/)],
  ["OBJ-MEMBER", "member of an object literal expression: modifier, `?`, `!`, no body, `= value`", r => (r.t !== null && ((r.ctx === "heritage" && has(r.t, /^\s*\{/)) || ((r.ctx === "targ" || r.ctx === "iextends") && has(r.t, /^\{ (\*a|a = 1|a!|readonly get)/)))) || (r.t === null && has(r.src, /^\(\{ .*\}\);$/))],
  ["EMPTY-TPARAMS", "empty type parameter list `<>`", r => r.t !== null && has(r.t, /<>/) && !has(r.t, /^import/)],
  ["IMPORT-TARGS", "import type with type arguments and no qualifier: `import('x')<A>`", r => r.t !== null && has(r.t, /^import\('x'\)<|^\('x'\)<|import\(\)<A>/) && r.ctx !== "heritage" && r.ctx !== "iextends"],
  ["IMPORT-PRIVATE", "import type whose qualifier is a private name: `import('x').#a`", r => r.t !== null && has(r.t, /\)\.#a/) && r.ctx !== "heritage" && r.ctx !== "iextends"],
  ["DOT-LESS-THAN", "`.<` before type arguments: `typeof a.<C>`, `import('x').A.<C, D>`", r => r.t !== null && has(r.t, /\.</)],
  ["IMPORT-ARG", "import type whose argument is no string literal", r => r.t !== null && has(r.t, /^import\(/) && r.ctx === "alias"],
  ["IMPORT-CALL", "`import()` with no argument in an expression", r => r.t !== null && has(r.t, /^import\s*\(\)/) && (r.ctx === "heritage" || r.ctx === "iextends")],
  ["ARROW-NEWLINE", "line break before `=>`", r => has(r.lint.bun, /^Unexpected newline before "=>"/)],
  ["JSDOC-TYPE", "JSDoc type: `?A`, `A?`, `!A`, `*`", r => r.t !== null && (r.prod === "jsdoc" || has(r.t, /\[(keyof|readonly|unique)\? A\]/))],
  ["ASSERTS", "`asserts x` outside a return type", r => has(r.src, /\basserts\b/) && (r.t !== null || has(r.src, /: asserts b/))],
  ["UNIQUE", "`unique` before a type that is not `symbol`", r => r.t !== null && has(r.t, /\bunique\b/)],
  ["PARAM-MODIFIER-DISCARD", "modifier of a parameter in a type that the Discard sink reads (alias)", r => r.t !== null && r.ctx === "alias" && has(r.t, /\[\s*in\s+\w|\[in\s+T|\[public k|^\((static|abstract|accessor|async|declare|in|out) /)],
  ["VARIANCE-MESSAGE", "`in` / `out` on a type parameter of a function type or an arrow", r => has(r.lint.bun, /^The modifier "(in|out)" is not valid here/)],
  ["TPARAM-CONSTRAINT-EXPR", "constraint of a type parameter that starts an expression and no type", r => r.t !== null && r.ctx === "tparam" && (r.prod === "literal" || r.prod === "junk")],
  ["HERITAGE-CLAUSES", "heritage clauses: empty list, trailing comma, a clause twice or out of order, two base classes, no class name", r => (r.t !== null && (r.ctx === "heritage" || r.ctx === "iextends") && (has(r.t, /extends/) || r.t === "")) || (r.t === null && has(r.src, /^(let x = )?(declare )?class( C)? (implements|extends)\b.*\{\s*\};?$|^declare class \{ \}$/) && !has(r.src, /constructor|accessor|abstract a|@d/))],
  ["TYPE-MEMBER-EXPORT", "`export` before a member of an object type that the Build sink reads", r => r.t === "{ export a: A }"],
  ["READONLY-PAREN-ARROW", "`readonly (T)` before `=>` of an arrow function", r => r.t === "readonly ([])"],
  ["PRIVATE-NAME-EXPR", "a private name that is an operand", r => r.t === "#a"],
  ["SUPER", "`super` outside a class", r => has(r.lint.bun, /^Unexpected "super"/)],
  ["HTML-COMMENT", "`<!--` read as a comment", r => has(r.lint.bun, /Legacy HTML comments/)],
  ["ARRAY-AWAIT", "`[await]` in an expression", r => r.t === "[await]"],
  // the targeted corpus
  ["PARAM-MODIFIER", "modifier of a parameter that is no parameter property: static, declare, abstract, accessor; a modifier before a pattern or a rest; a modifier in an arrow", r => r.t === null && has(r.src, /constructor\((static|declare|abstract|accessor|public \{|public \[|public \.\.\.)|^\((public|readonly) a: A\) =>/)],
  ["THIS-ARROW", "`this` parameter of an arrow function", r => r.src === "(this: A) => a;"],
  ["MODULE-STMT", "`module 'm'`, `namespace` and `global` where Bun reads no declaration", r => r.t === null && has(r.src, /^(export )?module ['"]m['"]|declare module 'm' \{\} \}$|^global \{|namespace N \{\}( \})?$|^declare global;$/) && !has(r.src, /^namespace/)],
  ["DECLARE-NO-DECL", "`declare` before what is no declaration", r => r.t === null && has(r.src, /^declare (a|\{|1|if|return|export|import a from|class \{)/)],
  ["MEMBER-MODIFIER", "modifiers of a class member or of a statement: order, twice, `accessor` with a method or an accessor, `abstract` before a statement", r => r.t === null && has(r.src, /\{ accessor (static|readonly|get|m\()|abstract abstract|^abstract (interface|enum|function|const)/)],
  ["ENUM-MEMBER-NAME", "name of an enum member: computed, number, bigint, private", r => r.t === null && has(r.src, /^enum E \{ (\[a\]|1|1n|#a) = 1 \}$/)],
  ["NAMESPACE-BODY", "import and export forms inside a namespace or a block", r => r.t === null && has(r.src, /^namespace N \{ (export \{|export default|export \*|import a from)|\{ export type A = 1; \}$|^\{ import type/)],
  ["EXPORT-IMPORT", "`export import` that is no `import =`", r => r.t === null && has(r.src, /^export import (A from|\{)/)],
  ["VAR-DECL", "variable declarations: `const` without a value, `!` without a type or with a value, `using` before a pattern, a value of a catch binding", r => r.t === null && has(r.src, /^(declare\n)?const a?x?!?: \w+;$|^let a!( = 1)?;$|^using \{|catch \(e: any = 1\)|\{ export const a: A \}$/)],
  ["USING-DECLARE", "`declare using`", r => has(r.lint.bun, /^Cannot use "declare" with/)],
  ["IMPORT-FORMS", "`import type A, { B }`, `import defer a`, `import A = require(a)`, `export { type if }`", r => r.t === null && has(r.src, /^import type A, |^import defer |^import A = require\(a\)|^export \{ type if \}/)],
  ["DECORATOR-TARGET", "decorator before what is no class: a statement, a constructor", r => r.t === null && has(r.src, /^@d (interface|type|enum|namespace|function|let)\b|@d constructor/)],
  ["DECORATOR-EXPR", "decorator expression that the standard grammar refuses (standard_decorators on)", r => r.t === null && has(r.src, /^@(d\?\.e|d`e`|new d) class/)],
  ["DECORATOR-PRIVATE", "decorator before a private member (standard_decorators off)", r => r.src === "class C { @d #a: string }"],
  ["REDECLARED", "a name declared twice: the parse pass reports it", r => has(r.lint.bun, /has already been declared/)],
  ["ARROW-TYPE-PARAMS-OUT", "`<out T>(a: T) => a`", r => r.src === "const v = <out T>(a: T) => a;"],
];

const files = [];
const table = new Map();
const unclassified = [];
for (const path of joins) {
  const dialect = /\.tsx\./.test(path) ? "tsx" : "ts";
  const cfgTla = /\.(tla|lint)\.join/.test(path);
  const name = path.replace(/^.*\//, "").replace(".join.jsonl", "");
  files.push(name);
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"cls":"TL"')) continue;
    const r = JSON.parse(line);
    if (r.cls !== "TL") continue;
    r.cfgTla = cfgTla;
    const c = chk.get(r.src)?.[dialect];
    r.g = c ? c.grammar.map(d => d[0]) : null;
    r.o = c ? c.other : null;
    let id = "UNCLASSIFIED";
    for (const [fid, , test] of FAMILIES) {
      if (test(r)) { id = fid; break; }
    }
    if (id === "UNCLASSIFIED") unclassified.push([name, r]);
    if (!table.has(id)) table.set(id, { counts: {}, rows: [], chk: {}, msgs: {} });
    const e = table.get(id);
    e.counts[name] = (e.counts[name] ?? 0) + 1;
    e.rows.push([name, r]);
    const verdict = r.g === null ? "tsc rejects" : r.g.length ? "TS" + r.g.join("+TS") : r.o.filter(x => ![2304, 2307, 7006, 2318, 2564, 7008, 2503, 2339, 2635, 2502].includes(x)).length ? "other: TS" + r.o.filter(x => ![2304, 2307, 7006, 2318, 2564, 7008, 2503, 2339, 2635, 2502].includes(x)).join("+TS") : "nothing";
    e.chk[verdict] = (e.chk[verdict] ?? 0) + 1;
    const key = `TS${r.lint.code} ${r.lint.bun.replace(/"[^"]*"/g, '"_"')}`;
    e.msgs[key] = (e.msgs[key] ?? 0) + 1;
  }
}
const title = id => FAMILIES.find(f => f[0] === id)?.[1] ?? "";
const list = flag("list");
console.log(["family", ...files].join("\t"));
const order = [...FAMILIES.map(f => f[0]), "UNCLASSIFIED"].filter(id => table.has(id));
for (const id of order) {
  const e = table.get(id);
  console.log([id, ...files.map(f => e.counts[f] ?? 0)].join("\t"));
}
console.log(["TOTAL", ...files.map(f => order.reduce((n, id) => n + (table.get(id).counts[f] ?? 0), 0))].join("\t"));
console.log("");
for (const id of order) {
  const e = table.get(id);
  if (list && list !== id) continue;
  console.log(`== ${id}: ${title(id)}`);
  console.log(`   checker of tsc 6.0.2: ${Object.entries(e.chk).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ")}`);
  console.log(`   messages of the lint parse: ${Object.entries(e.msgs).sort((a, b) => b[1] - a[1]).slice(0, list ? 100 : 6).map(([k, n]) => `${k} x${n}`).join("; ")}`);
  const seen = new Set();
  let shown = 0;
  for (const [name, r] of e.rows) {
    if (seen.has(r.src)) continue;
    seen.add(r.src);
    if (shown++ >= (list ? 1000 : nExamples)) continue;
    console.log(`     ${JSON.stringify(r.src)}  [${name}] lint: TS${r.lint.code} at ${r.lint.at} ${JSON.stringify(r.lint.bun)}`);
  }
  console.log(`   distinct sources: ${seen.size}`);
}
