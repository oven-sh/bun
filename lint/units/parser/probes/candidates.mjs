// Writes candidate rows for test/bundler/transpiler/typescript-grammar.test.ts.
//
// usage: bun candidates.mjs          (the installed release bun; reads out/*.jsonl and out/metadata.diff.tsv)
// Writes
//   out/candidates.typescript-grammar.test.ts   one test.each table per group
//   out/candidates.excluded.tsv                 inputs of class A1c that are NOT rows, with the reason
//
// A row is [input, expected output]. The input is of class A1c: tsc 6.0.2 parses it and reports nothing
// about its syntax, the installed bun rejects it. The expected output is never invented:
//   - "neutral"    the input stands in a type position: the output of the same input with the form
//                  replaced by the type `A`, from the installed bun (a type is erased whole);
//   - "equivalent" the output of the installed bun for another spelling of the same program, named in EQUIVALENT;
//   - "tsc"        the installed bun prints the JavaScript that ts.transpileModule made from the input
//                  (with the js loader when the TypeScript loader rejects that JavaScript as well);
//   - "bun without tsconfig"  for `accessor` under experimentalDecorators only: what the installed bun prints
//                  for the same input without tsconfig. This one is an inference, the row says so.
// Rows whose only fault is a reserved word in the place of a type name (`let x: if`) are kept apart: tsc builds a
// type reference for them and reports "Cannot find name", and no declaration can give such a name a meaning.
// Every row is run through the installed bun before it is written: a row that passes today is dropped and
// listed in the excluded file.
//
// The metadata table takes its rows from out/metadata.diff.tsv: the causes that belong to the type grammar.
// The expected value is the tag of tsc 6.0.2 (strictNullChecks off), spelled the way Bun prints a tag.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPE_CONTEXTS } from "./inputs/_lib.mjs";
import { effective, readRecords } from "./report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const ts = (await import(TS_PATH)).default;

const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
};
const bun = (src, which = "ts") => {
  try {
    return { ok: true, out: transpilers[which].transformSync(src) };
  } catch (e) {
    const first = e && Array.isArray(e.errors) && e.errors.length ? e.errors[0] : e;
    return { ok: false, message: String(first?.message ?? first) };
  }
};
const tscJs = (src, fileName = "input.ts") =>
  ts
    .transpileModule(src, {
      fileName,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, useDefineForClassFields: true, noEmitHelpers: true },
    })
    .outputText.replace(/^"use strict";\n/, "");

// Why an input of class A1c is not a row.
function excluded(e) {
  const src = e.r.src;
  const msg = e.bun[0][0];
  if (/^declare\b/.test(src)) {
    let js = "";
    try {
      js = tscJs(src);
    } catch {}
    if (/(^|\n)declare\b/.test(js) || js.trim() === "declare;")
      return "tsc reads `declare` as an identifier and gives no diagnostic for the missing semicolon (parser.go:2080-2082); the statement is not a declaration";
  }
  if (/get #a\(\)/.test(src) && /^(type X|interface I|let x)/.test(src)) return "private name on an accessor of a type literal: tsc reports TS18016 for a property and for a method and nothing for the accessor";
  if (/Cannot use "(await|yield|arguments|eval)"|Cannot use "yield" or "await"/.test(msg)) return "early error of Bun on the name (await, yield, arguments, eval); tsc reports it outside the grammar codes or not at all";
  if (/\bawait\b/.test(e.r.form ?? "") || /^(await)$/.test(e.r.form ?? "")) return "the name `await`: Bun treats the input as a module";
  if (/Private name|Expected identifier but found "#/.test(msg)) return "private name outside a class body: early error of Bun";
  if (/single-statement context/.test(msg)) return "declaration in a single-statement context: early error of Bun";
  if (e.r.fam === "exportSpec" || (e.r.fam === "exportType" && /\{ (default|"a"|if) \}/.test(src))) return "export of a local name that cannot be declared (default, a keyword, a string): no program can use it";
  if (/catch \(e: any = 1\)/.test(src)) return "initializer on a catch binding: not ECMAScript; tsc reports nothing";
  if (/import\.defer\(|^import defer "x"/.test(src)) return "import defer forms: an ECMAScript proposal, not type syntax";
  if (e.r.fam === "directive") return "the comment directive hides the diagnostic of tsc";
  if (/^"?<A"?$/.test(e.r.form ?? "") && e.r.ctx === "instImport") return "unterminated input";
  if (/^@d(<T>\(1\)<U>|\(\)<T>)$/.test(e.r.form ?? "")) return "a decorator followed by a line break and `<`: tsc reads a type argument list of an instantiation expression that no program needs";
  return null;
}

// Another spelling of the same program that the installed bun accepts. [pattern, replacement, loader].
const EQUIVALENT = [
  [/^type (as|satisfies)\b/, "type A"],
  [/^(export |declare )?type (as|satisfies)\b/, "$1type A"],
  [/^((?:export default |export |declare )?interface) (as|satisfies)\b/, "$1 A"],
  [/^namespace N \{ export type (as|satisfies) = 1 \}$/, "namespace N { export type A = 1 }"],
  [/\[(["'`])x\1\]/, '"x"'],
  [/^abstract declare class/, "declare abstract class"],
  [/^export abstract declare class/, "export declare abstract class"],
  [/^export default @d abstract class C \{\}$/, "@d export default abstract class C {}"],
  [/\[k: string\]: T, /, "[k: string]: T; "],
  [/\.\.\.a(: A\[\])?,\)/, "...a$1)"],
  [/\nwith \{/, " with {"],
  [/@d\(\)!/, "@d()"],
  [/^namespace N \{ import\("x"\); \}$/, 'namespace N { (import("x")); }'],
  [/^namespace N \{ import\.meta; \}$/, "namespace N { (import.meta); }"],
];

// Rows whose name is the point: the equivalent uses the name QQ and the output is renamed back.
const RENAME = [
  [/^(namespace|declare namespace) (as|satisfies)\b/, (m, kw, name) => `${kw} QQ`, (out, m) => out.replaceAll("QQ", m[2])],
  [/^(namespace) (as|satisfies)\.(as|satisfies)\b/, (m, kw) => `${kw} QQ.QQ`, (out, m) => out.replaceAll("QQ", m[2])],
];

const RESERVED = /(^|[^\w$."'`#])(if|class|function|delete|in|var|with|enum|default|super|instanceof|extends|export|return|switch|while|do|for|try|catch|throw|else|case|break|continue|debugger|finally|const)\b(?!\s*[:?]\s)/;
const RESERVED_FAMILIES = new Set(["ref", "label", "union", "op", "paren", "tmpl", "core", "cast", "as", "arrow", "tparamsArrow"]);
const isReservedName = e => RESERVED_FAMILIES.has(e.r.fam) && (RESERVED.test(e.r.form ?? "") || /^\[\.\.\.\w+: A\[\]\]$/.test(e.r.form ?? ""));

function expectedFor(e, which) {
  const src = e.r.src;
  if (which === "deco" && /\baccessor\b/.test(src) && !/^declare /.test(src)) {
    const plain = bun(src, "ts");
    if (plain.ok) return { how: "bun without tsconfig (inference)", out: plain.out };
  }
  if (e.r.form !== undefined && TYPE_CONTEXTS[e.r.ctx] && TYPE_CONTEXTS[e.r.ctx](e.r.form) === src) {
    const neutral = bun(TYPE_CONTEXTS[e.r.ctx]("A"), which);
    if (neutral.ok) return { how: "neutral", out: neutral.out };
  }
  for (const [pattern, replacement] of EQUIVALENT) {
    if (!pattern.test(src)) continue;
    const other = src.replace(pattern, replacement);
    if (other === src) continue;
    const r = bun(other, which);
    if (r.ok) return { how: `equivalent ${JSON.stringify(other)}`, out: r.out };
  }
  for (const [pattern, make, back] of RENAME) {
    const m = pattern.exec(src);
    if (!m) continue;
    const other = src.replace(pattern, make).replaceAll(new RegExp(`\\b${m[2]}\\b`, "g"), "QQ");
    const r = bun(other, which);
    if (r.ok) return { how: `equivalent ${JSON.stringify(other)} renamed`, out: back(r.out, m) };
  }
  let js;
  try {
    js = tscJs(src, which === "tsx" ? "input.tsx" : "input.ts");
  } catch {
    return null;
  }
  const r = bun(js, which);
  if (r.ok) return { how: "tsc", out: r.out };
  // The JavaScript of tsc is rejected by the TypeScript loader too: the js loader prints it.
  try {
    return { how: "tsc, printed by the js loader", out: new Bun.Transpiler({ loader: which === "tsx" ? "jsx" : "js" }).transformSync(js) };
  } catch {
    return null;
  }
}

const GROUPS = [
  ["01-type-forms", "type forms"],
  ["02-object-types", "object types, interfaces, aliases, mapped types"],
  ["03-signatures", "function and constructor types with signature parameters"],
  ["04-type-params-args", "type parameters and type arguments"],
  ["05-assertions", "assertions, instantiation expressions, generic arrows"],
  ["06-class-members", "class members, modifiers, overloads, parameter properties"],
  ["07-module-syntax", "module syntax"],
  ["08-declare-namespace-enum", "declare, namespace, enum, ambient modules"],
  ["09-decorators", "decorators"],
  ["10-declaration-files", "declaration files"],
];

// The contexts a form is shown in, in order of preference, and how many.
const PREFER = ["var", "alias", "arrowRet", "callArg", "param", "as", "field", "fnTypeParam", "typeArg", "tupleEl", "member", "ret", "arrowParam"];
const PER_FORM = 2;

const excludedLines = ["group\tfamily\tinput\tbun\treason"];
const tables = [];
for (const [base, title] of GROUPS) {
  const recs = readRecords(base);
  const rows = [];
  const runs = [["ts", "plain", "ts"]];
  if (base.startsWith("04") || base.startsWith("05")) runs.push(["tsx", "plain", "tsx"]);
  if (base.startsWith("06") || base.startsWith("09")) runs.push(["ts", "deco", "deco"]);
  const taken = new Set();
  for (const [dialect, config, which] of runs) {
    const byForm = new Map();
    for (const e of effective(recs, dialect, config)) {
      if (e.sub !== "A1c") continue;
      const key = `${e.r.fam}\t${e.r.form ?? e.r.src}`;
      if (!byForm.has(key)) byForm.set(key, []);
      byForm.get(key).push(e);
    }
    for (const list of byForm.values()) {
      list.sort((a, b) => {
        const ia = PREFER.indexOf(a.r.ctx);
        const ib = PREFER.indexOf(b.r.ctx);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      let n = 0;
      const limit = isReservedName(list[0]) ? 1 : PER_FORM;
      for (const e of list) {
        if (n >= limit) break;
        const id = which + "\t" + e.r.src;
        if (taken.has(id) || (which !== "ts" && taken.has("ts\t" + e.r.src))) continue;
        const why = excluded(e);
        if (why) {
          excludedLines.push([base, e.r.fam, JSON.stringify(e.r.src), JSON.stringify(e.bun[0][0]), why].join("\t"));
          n++;
          continue;
        }
        const now = bun(e.r.src, which);
        if (which === "deco" && !now.ok && /panic|crash/i.test(now.message)) continue;
        if (now.ok) {
          excludedLines.push([base, e.r.fam, JSON.stringify(e.r.src), "accepts", "accepted by the installed bun when run alone"].join("\t"));
          continue;
        }
        const exp = expectedFor(e, which);
        if (!exp) {
          excludedLines.push([base, e.r.fam, JSON.stringify(e.r.src), JSON.stringify(now.message), "no expected output could be derived"].join("\t"));
          continue;
        }
        taken.add(id);
        rows.push({ which: isReservedName(e) ? which + ".reserved" : which, src: e.r.src, expected: exp.out, how: exp.how, fam: e.r.fam, bun: now.message });
        n++;
      }
    }
  }
  tables.push({ base, title, rows });
}

// Declaration files: no d.ts mode exists in Bun.Transpiler. The rows are the inputs that tsc parses as
// input.d.ts without a diagnostic and that the ts loader rejects; the expected output of a declaration file is empty.
{
  const table = tables.find(t => t.base.startsWith("10"));
  const seen = new Set(table.rows.map(r => r.src));
  for (const e of effective(readRecords("10-declaration-files"), "dts", "plain")) {
    if (e.sub !== "A1c" || seen.has(e.r.src)) continue;
    const why = excluded(e);
    if (why) {
      excludedLines.push(["10-declaration-files", e.r.fam, JSON.stringify(e.r.src), JSON.stringify(e.bun[0][0]), why].join("\t"));
      continue;
    }
    seen.add(e.r.src);
    table.rows.push({ which: "dts", src: e.r.src, expected: "", how: "a declaration file has no output", fam: e.r.fam, bun: e.bun[0][0] });
  }
}

// ───────────────────────── metadata rows ─────────────────────────

const IN_GRAMMAR = /^(tree shape|type predicate|merge rule|name read as a modifier|form without a tag|readonly operand)/;
const spell = tag => {
  if (tag.startsWith("[")) {
    const inner = tag.slice(1, -1);
    return "[" + (inner ? inner.split(", ").map(spell).join(", ") : "") + "]";
  }
  if (tag === "BigInt" || tag === "Symbol") return `typeof ${tag} === "undefined" ? Object : ${tag}`;
  const m = /^Ref\((.+)\)$/.exec(tag);
  if (!m) return tag;
  const parts = m[1].split(".");
  const tests = parts.map((_, i) => `typeof ${parts.slice(0, i + 1).join(".")} === "undefined"`);
  return `${tests.join(" || ")} ? Object : ${m[1]}`;
};
const parseShown = shown => {
  const r = {};
  if (shown === "(none)") return r;
  for (const part of shown.split("  ")) {
    const at = part.indexOf("=");
    r[part.slice(0, at)] = part.slice(at + 1);
  }
  return r;
};
const metadataRows = [];
{
  const lines = readFileSync(join(OUT, "metadata.diff.tsv"), "utf8").split("\n").slice(1).filter(Boolean);
  const perCause = new Map();
  for (const line of lines) {
    const [cause, form, position, input, bunShown, looseShown, strictShown] = line.split("\t");
    if (!IN_GRAMMAR.test(cause)) continue;
    if (!["prop", "param", "ret"].includes(position)) continue;
    if (looseShown !== strictShown) continue;
    const key = cause + "\t" + position;
    const n = perCause.get(key) ?? 0;
    if (n >= 12) continue;
    perCause.set(key, n + 1);
    const loose = parseShown(looseShown);
    if (!Object.keys(loose).length) continue;
    // tsc prints `typeof const` for the type name `const`: not a program.
    if (/Ref\((const|if|class|function|var|enum|new|typeof|void|in|delete|default|export|extends|super|this|null|true|false)\b/.test(looseShown)) continue;
    const expected = Object.fromEntries(Object.entries(loose).map(([k, v]) => [k, spell(v)]));
    metadataRows.push({ cause, src: JSON.parse(input), expected, old: bunShown, tsc: looseShown });
  }
}

// ───────────────────────── write ─────────────────────────

const q = s => JSON.stringify(s);
const lines = [];
lines.push(`// Candidate rows. Each row fails with the installed release bun (${Bun.version} ${Bun.revision.slice(0, 9)}).`);
lines.push(`// Oracle: tsc ${ts.version}. Generated by notes/lint/units/parser/probes/candidates.mjs; see that file for how an expected output is derived.`);
lines.push(`import { describe, expect, test } from "bun:test";`);
lines.push(``);
lines.push(`const decorators = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });`);
lines.push(`const transpilers = {`);
lines.push(`  ts: new Bun.Transpiler({ loader: "ts" }),`);
lines.push(`  tsx: new Bun.Transpiler({ loader: "tsx" }),`);
lines.push(`  deco: new Bun.Transpiler({ loader: "ts", tsconfig: decorators }),`);
lines.push(`};`);
lines.push(``);
let total = 0;
for (const t of tables) {
  const byWhich = new Map();
  for (const r of t.rows) {
    if (!byWhich.has(r.which)) byWhich.set(r.which, []);
    byWhich.get(r.which).push(r);
  }
  lines.push(`describe(${q(t.title)}, () => {`);
  for (const [which, rows] of byWhich) {
    total += rows.length;
    if (which === "dts") {
      lines.push(`  // tsc parses each input as a declaration file without a diagnostic. Bun.Transpiler has no loader for a`);
      lines.push(`  // declaration file: these rows belong to the test of the lint parse (lint-parse*.test.ts).`);
      lines.push(`  test.todo.each([`);
      for (const r of rows) lines.push(`    [${q(r.src)}], // bun now: ${r.bun}`);
      lines.push(`  ])("d.ts %j", () => {});`);
      continue;
    }
    const [loader, reserved] = which.split(".");
    if (reserved) lines.push(`  // A reserved word stands where a type name is expected. tsc parses a type reference and reports TS2304.`);
    lines.push(`  test.each([`);
    for (const r of rows) lines.push(`    [${q(r.src)}, ${q(r.expected)}], // ${r.fam}; bun now: ${r.bun}; expected: ${r.how}`);
    lines.push(`  ])(${q(loader + (reserved ? " reserved word" : "") + " %j")}, (source, expected) => {`);
    lines.push(`    expect(transpilers.${loader}.transformSync(source)).toBe(expected);`);
    lines.push(`  });`);
  }
  if (!t.rows.length) lines.push(`  // No input of this group is parsed by tsc without a diagnostic and rejected by Bun.`);
  lines.push(`});`);
  lines.push(``);
}
lines.push(`// The text of the second argument of every call ("design:type" | "design:paramtypes" | "design:returntype", value).`);
lines.push(`function metadata(js: string) {`);
lines.push(`  const found: Record<string, string> = {};`);
lines.push(`  const call = /\\(\\s*"design:(type|paramtypes|returntype)"\\s*,/g;`);
lines.push(`  for (let m = call.exec(js); m; m = call.exec(js)) {`);
lines.push(`    let depth = 0;`);
lines.push(`    let end = call.lastIndex;`);
lines.push(`    for (; end < js.length; end++) {`);
lines.push(`      const c = js[end];`);
lines.push(`      if (c === "(" || c === "[") depth++;`);
lines.push(`      else if (c === ")" || c === "]") {`);
lines.push(`        if (depth === 0) break;`);
lines.push(`        depth--;`);
lines.push(`      }`);
lines.push(`    }`);
lines.push(`    found[m[1]] = js.slice(call.lastIndex, end).replace(/\\s+/g, " ").trim().replace(/^\\[ /, "[").replace(/ \\]$/, "]");`);
lines.push(`  }`);
lines.push(`  return found;`);
lines.push(`}`);
lines.push(``);
lines.push(`describe("emitDecoratorMetadata", () => {`);
const byCause = new Map();
for (const r of metadataRows) {
  if (!byCause.has(r.cause)) byCause.set(r.cause, []);
  byCause.get(r.cause).push(r);
}
let metaTotal = 0;
for (const [cause, rows] of byCause) {
  lines.push(`  // ${cause}`);
  lines.push(`  test.each([`);
  for (const r of rows) {
    // The row must fail today.
    const now = bun(r.src, "deco");
    if (!now.ok) continue;
    metaTotal++;
    lines.push(`    [${q(r.src)}, ${q(r.expected)}], // old: ${r.old}; tsc: ${r.tsc}`);
  }
  lines.push(`  ])("%j", (source, expected) => {`);
  lines.push(`    expect(metadata(transpilers.deco.transformSync(source))).toEqual(expected);`);
  lines.push(`  });`);
}
lines.push(`});`);
lines.push(``);
writeFileSync(join(OUT, "candidates.typescript-grammar.test.ts"), lines.join("\n"));
writeFileSync(join(OUT, "candidates.excluded.tsv"), excludedLines.join("\n") + "\n");
console.log(`rows ${total}, metadata rows ${metaTotal}, excluded ${excludedLines.length - 1}`);
for (const t of tables) console.log(` ${t.base}: ${t.rows.length}`);
