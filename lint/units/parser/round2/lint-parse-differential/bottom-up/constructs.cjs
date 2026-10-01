// The forms of corpus.small by construct: why the lint parse and tsc differ on a form, counted over its contexts.
//   node constructs.cjs <j2.small.jsonl> <A|B> [--unmatched=1]
// A row: the construct, the forms it holds, the parses (as ts, as tsx) by who reads the place
// (built: a Build-read type position; expr: the type stands in an expression; alias: the body of a type alias; iext: interface extends; impl: class implements).
const fs = require("fs");
const readline = require("readline");
const args = process.argv.slice(2);
const [file, cls] = args.filter(a => !a.startsWith("--"));
const showUnmatched = args.includes("--unmatched=1");
const BUILD = new Set(["var", "field", "param", "ctor", "ret", "fnparam", "fnret", "arrowparam", "as", "satisfies", "tparam"]);
const EXPR = new Set(["targ", "angle", "ternary", "arrowret"]);
const place = ctx => (BUILD.has(ctx) ? "built" : EXPR.has(ctx) ? "expr" : ctx === "alias" ? "alias" : ctx === "iextends" ? "iext" : "impl");
// [name, test(form, prod, record)] in order: the first that holds names the construct.
const RULES_A = [
  ["await as a parameter name of a function type (top_level_await)", (t, p) => /\bawait\b/.test(t) && p === "function-type"],
  ["await<A in tsx (top_level_await)", (t) => t === "await<A"],
  ["asserts predicate outside a return type", (t) => /\basserts\b/.test(t) && !/=>\s*asserts\s*$/.test(t)],
  ["line break before => of an arrow function", (t, p, r) => /Unexpected newline before/.test(r.lint.bun)],
  ["unique before a type that is not symbol", (t) => /\bunique\b/.test(t)],
  ["JSDoc type: ?T, T?, !T, *, ?, function(...)", (t, p) => p === "jsdoc" || /^\(\?\)/.test(t) || /\[\?, /.test(t) || /\?\s*A\]$/.test(t) || t === "function () {}" || /^\(\?\) =>/.test(t)],
  ["empty type parameter list <>", (t) => /<>\s*\(/.test(t) || /<>\n\(/.test(t)],
  ["in/out on a type parameter of a function type", (t, p) => /<\s*(in|out)\b/.test(t) || /^out T>/.test(t)],
  ["modifier before a parameter of a function type", (t, p) => p === "function-type" && /^\((static|abstract|accessor|async|declare|in|out)\b/.test(t)],
  ["index signature whose parameter has a modifier or no name", (t, p) => /\[\s*in\s+T\]/.test(t) || /\[in\s+T\]/.test(t) || /\[public k/.test(t)],
  ["import type: argument that is no string", (t, p) => p === "import-type" && /^import\(\s*([^'\s)]|\s*\|)/.test(t) || t === "import('x' | 'y')"],
  ["import type: type arguments without a qualifier", (t, p) => /^import\('x'\)<>?/.test(t) || /^import\('x'\)<A>/.test(t)],
  ["import type or typeof: private name after the dot", (t) => /\.#a/.test(t)],
  ["A.<B>: type arguments after a dot", (t) => /\.<C/.test(t)],
  ["type member with the modifier export", (t) => /\{ export a/.test(t)],
  ["object literal member that the checker rejects (f<{...}>(x) read as a comparison)", (t, p) => p === "type-literal"],
  ["type parameter constraint read as an expression", (t, p, r) => r.ctx === "tparam" && (p === "junk" || p === "literal")],
  ["readonly before a parenthesized type in an arrow return type", (t) => t === "readonly ([])"],
  ["private name, super or <!-- in an expression", (t, p) => p === "junk"],
  ["conditional type without a check type (A extends  extends ? 1 : 2)", (t, p) => p === "infer"],
];
const RULES_B = [
  ["x is T outside a return type", (t, p) => /\bis\b/.test(t) && (p === "predicate" || p === "parenthesized" || p === "tuple")],
  ["unique read as a type name", (t) => /\bunique\b/.test(t)],
  ["function or constructor type as the operand of keyof or readonly", (t) => /^(keyof|readonly)\s+(new\s*)?\(/.test(t)],
  ["[] after infer U", (t) => /infer [AU]\[\]/.test(t)],
  ["tuple element that starts with a reserved word", (t, p) => p === "tuple" && /^\[(class|const|delete|enum|extends|in|var)\b/.test(t)],
  ["typeof a.#b (typescript-go parses it, tsc 6.0.2 does not)", (t) => t === "typeof a.#b"],
  ["type parameter constraint that tsc reads as an expression", (t, p, r) => r.ctx === "tparam"],
];
const rules = cls === "A" ? RULES_A : RULES_B;
const forms = new Map();
(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) {
    if (!line.includes(`"cls":"${cls}"`)) continue;
    const r = JSON.parse(line);
    if (r.cls !== cls) continue;
    let f = forms.get(r.t);
    if (!f) forms.set(r.t, (f = { prod: r.prod, recs: [] }));
    f.recs.push(r);
  }
  const rows = new Map();
  const unmatched = [];
  for (const [t, f] of forms) {
    for (const r of f.recs) {
      const pl = place(r.ctx);
      let name;
      if (pl === "iext") name = "(interface extends: an entry is read as a type first)";
      else if (pl === "impl") name = "(class implements: a type reference, else an expression of Bun's grammar)";
      else {
        const rule = rules.find(([, test]) => test(t, f.prod, r));
        name = rule ? rule[0] : pl === "alias" ? "(alias body only: read by the Discard sink)" : pl === "expr" ? "(other: the type stands in an expression)" : null;
        if (!name) { unmatched.push(`${f.prod} ${JSON.stringify(t)} ${r.ctx} ${r.d}`); name = "UNMATCHED"; }
      }
      let row = rows.get(name);
      if (!row) rows.set(name, (row = { forms: new Set(), n: {}, ex: null }));
      row.forms.add(t);
      const key = `${pl} ${r.d}`;
      row.n[key] = (row.n[key] ?? 0) + 1;
      if (!row.ex || r.src.length < row.ex.src.length) row.ex = r;
    }
  }
  const total = r => Object.values(r.n).reduce((a, b) => a + b, 0);
  for (const [name, row] of [...rows].sort((a, b) => total(b[1]) - total(a[1]))) {
    const c = pl => `${row.n[pl + " ts"] ?? 0}/${row.n[pl + " tsx"] ?? 0}`;
    console.log(`${String(total(row)).padStart(5)} parses ${String(row.forms.size).padStart(4)} forms | built ${c("built")} expr ${c("expr")} alias ${c("alias")} iext ${c("iext")} impl ${c("impl")} | ${name}`);
    const e = row.ex;
    console.log(`        e.g. [${e.d}] ${JSON.stringify(e.src)}  ${cls === "A" ? `lint ${e.lint.code ? "TS" + e.lint.code : "no code"} @${e.lint.off} ${JSON.stringify(e.lint.bun)}${e.chk.length ? `; tsc checker TS${e.chk[0][0]}` : ""}` : `tsc TS${e.tsc[0][0]}@${e.tsc[0][1]} ${JSON.stringify(e.tsc[0][3])}`}`);
  }
  if (showUnmatched) for (const u of unmatched.slice(0, 80)) console.log("UNMATCHED", u);
  console.log(unmatched.length, "unmatched");
})();
