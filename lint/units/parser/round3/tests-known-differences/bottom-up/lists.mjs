// Writes api-known-differences.txt: the paste source of the section "Known differences of a parse without lint" of API.md.
// usage: node lists.mjs [family ...]     the families named are listed as not read by a lint parse
// (reads rows.facts.json and corpus-lists.json; run gen/facts.mjs and corpus-lists.mjs first)
import { readFileSync, writeFileSync } from "node:fs";
import { FAMILIES, familyOf } from "./gen/families.mjs";
const here = new URL(".", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(here + "rows.facts.json", "utf8"));
const corpus = JSON.parse(readFileSync(here + "corpus-lists.json", "utf8"));
const notRead = new Set(process.argv.slice(2));
const FORM = { 2369: "TS2369", 2371: "TS2371", 2499: "TS2499", 2500: "TS2500", 1225: "TS1225", 1540: "TS1540", 2842: "TS2842" };
const TITLE = {
  "reserved-type-name": "A reserved word is the name of a type reference",
  "reserved-tuple-label": "A reserved word is the label of a rest element of a tuple",
  "import-type": "An import type takes type arguments; the value of an import attribute is an expression; `.<` stands before type arguments",
  "asserts-is-next-line": "The type of an assertion predicate starts on the line after its subject",
  "signature-initializer": "A parameter of a signature has an initializer (the checker of tsc: TS2371, no grammar error)",
  "signature-pattern": "An array pattern of a signature has a hole",
  "signature-parameter-modifier": "A modifier stands before a parameter of a signature (the checker of tsc: TS2369, no grammar error)",
  "out-in-name": "`out` and `in` name a type or a type parameter",
  "as-less-equals": "A comparison follows the type after `as` and `satisfies`",
  "interface-extends-expression": "An interface extends an expression (the checker of tsc: TS2499, no grammar error)",
  "class-implements-expression": "A class implements an expression (the checker of tsc: TS2500, no grammar error)",
  "function-parameter-modifier": "A modifier stands before a parameter of a function or method that is no constructor (the checker of tsc: TS2369, no grammar error)",
  "rest-parameter-comma": "A comma follows the rest parameter of a signature of a declared class",
  "index-signature-comma": "A comma ends an index signature of a class",
  "accessor-modifier": "`accessor` is a modifier with experimentalDecorators",
  "as-names-declaration": "`as` and `satisfies` name a type alias, an interface or a namespace",
  "abstract-declare": "`abstract` stands before `declare`",
  "enum-member-in-brackets": "A string in brackets names an enum member",
  "namespace-import-expression": "A statement of a namespace starts with `import(` or `import.`",
  "import-attributes-next-line": "The attributes of an import start on the line after its path",
  "colon-after-operand": "The colon of a conditional or of a case follows an operand that ends with a parenthesis",
  "conditional-colon": "The colon of a conditional follows `<T>(...)` in its true branch",
  "conditional-colon-in-arrow-body": "The colon of a conditional follows the parenthesized body of an arrow function in its true branch",
};
const q = text => JSON.stringify(text);
const LOADER = { ts: "ts", tsx: "tsx", js: "js", deco: "ts, experimentalDecorators" };
const out = [];
const emit = (line = "") => out.push(line);
const said = r => { const [text, line, column] = r.main[1][0]; return `${text} (${line}:${column})`; };

emit("PASTE SOURCE FOR /workspace/notes/lint/units/parser/API.md, section \"Known differences of a parse without lint\".");
emit("Made by lists.mjs from rows.facts.json (the 366 rows of the four removed test files) and corpus-lists.json. main = f4d755a9cf,");
emit("binary /workspace/base/bun.f4d755a9c. tsc = typescript 6.0.2. Replace the marked sentence when the routes of the lint parse are known.");
emit();
emit("## Known differences of a parse without lint");
emit();
emit("A parse without lint is the parser of main: what it accepts, what it rejects and what it prints are those of");
emit("`f4d755a9cf`. The lists below are where that parser differs from tsc 6.0.2 on TypeScript that tsc takes. They are");
emit("defects of main. This work does not fix them: a fix changes what every run and every bundle reads, and it costs the");
emit("type skipper its speed. Until this round, four test files (`test/bundler/transpiler/typescript-grammar*.test.ts`,");
emit("366 cases) asserted the other behaviour for a parse without lint. They are gone, and each case is a case of");
emit("`src/js_parser/parse/grammar_rows_tests.rs`, which reads the same source with a lint parse.");
emit();
emit("\"Valid\" means what it meant in round 2: tsc reports no parse diagnostic and its checker reports no grammar error.");
emit("Where the checker of tsc reports another rule for the form itself, the heading names its code.");
emit();

// ---- 1. valid TypeScript that main rejects
const valid = rows.filter(r => r.main[0] === "e" && r.valid);
const byFamily = new Map();
for (const r of valid) {
  const f = familyOf(r);
  if (!byFamily.has(f)) byFamily.set(f, new Map());
  const key = r.src;
  if (!byFamily.get(f).has(key)) byFamily.get(f).set(key, { src: r.src, loaders: new Set(), said: said(r), saidBy: {} });
  const e = byFamily.get(f).get(key);
  e.loaders.add(LOADER[r.loader]);
  e.saidBy[LOADER[r.loader]] = said(r);
}
const corpusCount = cause => (corpus.valid[cause] ?? []).length;
let total = 0;
for (const m of byFamily.values()) total += m.size;
emit("### Valid TypeScript that a parse without lint rejects");
emit();
emit(`${total} sources in ${byFamily.size} groups. Each line is the source and the first error of main, with its line and column.`);
emit("A source is read with the `ts` loader unless the line says otherwise. \"In the corpora\" counts the sources of the");
emit("three corpora of the differential harness (`testrows`, `targeted`, `small-sub`) that main rejects for the same cause.");
emit();
const ORDER = ["reserved-type-name", "reserved-tuple-label", "import-type", "asserts-is-next-line", "signature-initializer", "signature-pattern", "signature-parameter-modifier", "out-in-name", "as-less-equals", "interface-extends-expression",
  "class-implements-expression", "function-parameter-modifier", "rest-parameter-comma", "index-signature-comma", "accessor-modifier", "as-names-declaration", "abstract-declare", "enum-member-in-brackets", "namespace-import-expression", "import-attributes-next-line",
  "colon-after-operand", "conditional-colon", "conditional-colon-in-arrow-body"];
const inGrammar = f => FAMILIES[f].route === "grammar";
for (const part of [true, false]) {
  emit(part ? "Inside the type skipper (`src/js_parser/parse/parse_skip_typescript.rs`):" : "Outside the type skipper:");
  emit();
  for (const f of ORDER) {
    if (!byFamily.has(f) || inGrammar(f) !== part) continue;
    const m = byFamily.get(f);
    const n = corpusCount(FAMILIES[f].cause);
    emit(`**${TITLE[f]}.** ${m.size} sources${n ? `, ${n} in the corpora for the cause \"${FAMILIES[f].cause}\"` : ""}. Where main decides: ${FAMILIES[f].site}.`);
    emit();
    emit("```");
    for (const e of m.values()) {
      const loaders = [...e.loaders];
      const note = loaders.length === 1 && loaders[0] === "ts" ? "" : `   [${loaders.join("; ")}]`;
      emit(`${q(e.src)}  =>  ${e.said}${note}`);
    }
    emit("```");
    emit();
  }
}

// ---- 2. metadata
emit("### Decorator metadata that differs from tsc");
emit();
const meta = new Map();
for (const r of rows) {
  if (!r.key) continue;
  const key = r.src + "\0" + r.key;
  if (!meta.has(key)) meta.set(key, r);
}
const byMeta = new Map();
for (const r of meta.values()) {
  const f = familyOf(r);
  if (!byMeta.has(f)) byMeta.set(f, []);
  byMeta.get(f).push(r);
}
emit(`${meta.size} values in ${byMeta.size} groups, with \`experimentalDecorators\` and \`emitDecoratorMetadata\`. main accepts every source. Each line is the`);
emit("source, the key, the value of main and the value of tsc with `strictNullChecks` off. Where tsc writes a guarded");
emit("reference to a name (`typeof (_a = typeof x !== \"undefined\" && x.b) === \"function\" ? _a : Object`), the line has the");
emit("guard that Bun writes for the same name. `undefined` is how Bun prints `void 0`.");
emit();
const META_TITLE = {
  "metadata-union-check-type": "The operands of `|` and `&` are the check type of a conditional type: main reads `A | (B extends C ? D : E)`",
  "metadata-operator-before-extends": "The operand of `keyof`, `readonly` and `unique` ends before `extends`: main reads `keyof (A extends B ? C : D)`",
  "metadata-false-type-union": "The type after the colon of a conditional type takes `|` and `&`: main ends it before them",
  "metadata-keyword-dot": "A keyword before a dot is the first name of a type reference: main reads the keyword type and drops the rest",
  "metadata-unique-operand": "`unique` takes the whole type after it: main gives it the tag of the array or tuple (the checker of tsc: TS1005 `'symbol' expected.`)",
  "metadata-conditional-branches": "The branches of a conditional type merge as the operands of `|` do: main takes one branch",
  "metadata-operand-serialization": "An operand of `|` and `&` counts as what it serializes to: main skips `never`, `unknown`, nested unions and dotted names",
  "metadata-import-and-unique": "An import type and `unique symbol` are `Object`: main skips them among the operands, and gives `import(\"x\")[\"y\"]` the tag of an array",
  "metadata-predicates": "A type predicate is `Boolean` and an assertion predicate is `undefined`: main reads the name before `is` as a type",
};
const tscValue = r => r.expected;
for (const [f, list] of byMeta) {
  const n = (corpus.meta[FAMILIES[f].cause] ?? []).length;
  emit(`**${META_TITLE[f]}.** ${list.length} values${n ? `, ${n} sources in the corpora` : ""}.`);
  emit();
  emit("```");
  for (const r of list) {
    const chk = r.tsc.chk.length ? `   [the checker of tsc: TS${r.tsc.chk.map(c => c[0]).join(", TS")}]` : "";
    emit(`${q(r.src)}  design:${r.key}  main: ${r.mainDesign}  tsc: ${tscValue(r)}${chk}`);
  }
  emit("```");
  emit();
}

// ---- 3. other output
emit("### TypeScript that a parse without lint reads as another program");
emit();
const other = rows.filter(r => r.class === "X" && r.valid);
const seenOther = new Map();
for (const r of other) if (!seenOther.has(r.src)) seenOther.set(r.src, { r, loaders: new Set() }), seenOther.get(r.src).loaders.add(LOADER[r.loader]); else seenOther.get(r.src).loaders.add(LOADER[r.loader]);
emit(`${seenOther.size} sources. main accepts each and reads \`interface as {}\` and \`namespace as {}\` as the cast of the identifier \`interface\` or`);
emit("`namespace` to the type `{}`, where tsc reads a declaration named `as`. Each line is the source, what main prints, and");
emit("what tsc's program prints.");
emit();
emit("```");
for (const { r, loaders } of seenOther.values()) emit(`${q(r.src)}  main: ${q(r.main[1])}  tsc: ${q(r.expected)}${loaders.size > 1 || !loaders.has("ts") ? `   [${[...loaders].join("; ")}]` : ""}`);
emit("```");
emit();

// ---- 4. rows that are no difference
emit("### What the removed tests named and is no defect of main");
emit();
emit("tsc does not take these sources as a whole, so main's reading is not listed above:");
emit();
emit("```");
for (const r of rows) {
  if (r.valid || r.key) continue;
  const why = r.tsc.parse.length ? `tsc: TS${r.tsc.parse[0][0]} ${r.tsc.parse[0][3]} at offset ${r.tsc.parse[0][1]}` : `the checker of tsc: TS${r.tsc.chk[0][0]} ${r.tsc.chk[0][3]}`;
  const does = r.main[0] === "e" ? `main rejects: ${said(r)}` : `main prints ${q(r.main[1])}`;
  emit(`${q(r.src)}  [${LOADER[r.loader]}]  ${why}; ${does}`);
}
emit("```");
emit();

// ---- 5. lint parse
emit("### What a lint parse does with these sources");
emit();
emit("REPLACE WHEN THE ROUTES ARE KNOWN. A lint parse reads every source of the lists above as tsc does: the types with the lint");
emit("grammar, the rest through the sites that test the side table. `grammar_rows_tests.rs` holds each source with what tsc builds.");
if (notRead.size > 0) {
  emit("These groups are not read by a lint parse: their site has no place where a lint parse can branch without a cost to a");
  emit("parse without lint, so a lint parse reads them as main does (the constant `NOT_READ` of the test file).");
  emit();
  for (const f of notRead) {
    const n = rows.filter(r => familyOf(r) === f).length;
    emit(`- ${TITLE[f] ?? f} (${n} cases): ${FAMILIES[f].site}.`);
  }
}
emit();

// ---- 6. corpora
emit("### Checked against the corpora of round 2");
emit();
emit("The three corpora were run again with main at `f4d755a9cf`: `small-sub` (7,089 sources) gives the records of the run of");
emit("round 2 at `e3566be889` without a difference, and the tables of `diff.mjs` against the release build of round 1");
emit("(`23a20afa7e`) are those of `round2/a1-differential/top-down/runs/table.be1ebe5295.tsv`. Of the 153 sources of");
emit("`probes/valid.plain.txt`, main rejects each. Beyond the cases above, the corpora hold:");
emit();
const extra = [
  ["asserts is T is the assertion about a parameter named is", "`asserts is T`: the assertion about a parameter named `is` (the checker of tsc: TS1225 when no parameter has the name)"],
  ["valid TypeScript that no entry above names [tsc also: nothing]", "`[function]`, `[...if]`: a reserved word as an element of a tuple; `import('x').#a`; `{ [+1]: A }`, `{ get #a(): A }`"],
  ["ruling: tsc reports a rule of syntax outside its grammar checks TS1102", "`implements [delete A]` (tsc: TS1102 from its binder)"],
];
for (const [cause, text] of extra) {
  const list = corpus.valid[cause] ?? [];
  if (list.length === 0) continue;
  emit(`- ${list.length} sources that main rejects and round 1 accepted, with no case of their own: ${text}. Example: \`${list[0].src.replace(/\n/g, "\\n")}\` is \`${list[0].msg[0]}\`.`);
}
const both = corpus.valid["ROUND 1 REJECTS TOO"] ?? [];
emit(`- ${both.length} sources that tsc takes by the rule above and that main and round 1 both reject. No case named them and no grammar of this`);
emit("  work reads them: a lint parse rejects them too until its grammar is widened. Examples: `typeof import('x').a<>` (`Unexpected >`),");
emit("  `typeof a.<C>` (`Expected identifier but found \"<\"`), `A extends  extends ? 1 : 2` (`Unexpected extends`), `declare {};`, `export { type if };`,");
emit("  `try {} catch (e: any = 1) {}`, `enum E { [a] = 1 }` (tsc: TS1164).");
const same = corpus.meta["ROUND 1 HAS THE SAME VALUE"] ?? [];
emit(`- ${same.length} sources whose metadata differs from tsc in main and in round 1 alike. They need what no parse has (the declaration of the name:`);
emit("  a type alias, an enum, an interface, a type parameter), or are forms that no case named: a type named `asserts`, `abstract` or `const`");
emit("  (main: `Object`, tsc: the guarded name), `readonly` before a type that is no array (main: `Array`; the checker of tsc: TS1354), the return type of");
emit("  a method whose parameter has a decorator (main: `Object`, tsc: `void 0` or the type), the rest parameter (main: `Object`, tsc: the element type).");
writeFileSync(here + "api-known-differences.txt", out.join("\n") + "\n");
console.log(`api-known-differences.txt: ${total} valid sources that main rejects in ${byFamily.size} groups, ${meta.size} metadata values in ${byMeta.size} groups, ${seenOther.size} sources read as another program`);
