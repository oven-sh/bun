// Merges every surviving probe input of the parser unit into one corpus, one record per distinct source text.
//
//   bun build-corpus.mjs <out corpus.jsonl> [--calls=<recorded transformSync calls .jsonl>]
//
// Record: {"id": n, "src": "...", "o": ["<set>/<file>/<family or id>", ...up to 6], "sets": ["bu","td",...],
//          "tsx": true when some origin names the tsx dialect, "tsxOnly": true when every origin does,
//          "dts": true when some origin names a declaration file, "deco": true when some origin needs
//          experimentalDecorators, "meta": true when the origin compares decorator metadata}
// Origin sets (paths relative to the notes directory of the unit):
//   bu    probes/inputs/NN-*.mjs                    bottom-up tsc oracle probes (families name the productions)
//   td    probes/top-down/inputs/*.txt              top-down tsc oracle probes (records, types put into contexts)
//   otg   probes/outside-type-grammar/inputs/*.txt  one input per line
//   gd    grammar-diff/corpus.{small,targeted}.json the corpus of the differential harness (forms x contexts)
//   lex   lexer-lint-hooks/**/ *-inputs*.json       inputs of the diagnostic code, comment and pragma probes
//   sc    sidecar-*/, build-sink*/ inputs           inputs of the sidecar and position oracles
//   res   ledger/rescued-tmp/{gct1a-42866,otg_bottomup_7f3k}/*.txt   spot probes that existed only under /tmp
//   test  recorded calls of Bun.Transpiler in the existing tests (loader ts or tsx)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = join(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const outPath = args.find(a => !a.startsWith("--"));
const callsPath = args.find(a => a.startsWith("--calls="))?.slice(8);
if (!outPath) {
  console.error("usage: bun build-corpus.mjs <out corpus.jsonl> [--calls=<calls.jsonl>]");
  process.exit(2);
}

const bySrc = new Map();
const perSet = {};
function add(src, tag, hints = {}) {
  if (typeof src !== "string") return;
  const set = tag.slice(0, tag.indexOf("/"));
  perSet[set] ??= { inputs: 0, fresh: 0 };
  perSet[set].inputs++;
  let r = bySrc.get(src);
  if (!r) {
    r = { src, o: [], sets: new Set(), tsxAny: false, tsxAll: true, dts: false, deco: false, meta: false };
    bySrc.set(src, r);
    perSet[set].fresh++;
  }
  if (r.o.length < 6) r.o.push(tag);
  r.sets.add(set);
  if (hints.tsx) r.tsxAny = true;
  else r.tsxAll = false;
  if (hints.dts) r.dts = true;
  if (hints.deco) r.deco = true;
  if (hints.meta) r.meta = true;
}

// bu
{
  const dir = join(UNIT, "probes", "inputs");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".mjs") && !f.startsWith("_")).sort()) {
    const group = (await import(join(dir, file))).default;
    const nn = file.slice(0, 2);
    const programs = group.programs ?? ["ts"];
    for (const c of group.cases) {
      add(c.src, `bu/${nn}/${c.fam}${c.ctx ? "@" + c.ctx : ""}`, {
        dts: programs.includes("dts"),
        deco: !!group.decoProgram || !!group.metadata,
        meta: !!group.metadata,
      });
    }
  }
}

// td: the context table is the one of probes/top-down/runner.mjs.
const TD_CONTEXTS = {
  alias: T => `type X = ${T};`,
  var: T => `let x: ${T};`,
  param: T => `function f(x: ${T}) {}`,
  ret: T => `function f(x: any): ${T} { return null as any }`,
  arrowp: T => `let f = (x: ${T}) => x;`,
  arrowr: T => `let f = (x: any): ${T} => x;`,
  as: T => `let v = x as ${T};`,
  satis: T => `let v = x satisfies ${T};`,
  angle: T => `let v = <${T}>x;`,
  targ: T => `f<${T}>(x);`,
  tparam: T => `function f<U extends ${T}, V = ${T}>() {}`,
  prop: T => `class K { @d p: ${T}; }`,
  mparam: T => `class K { @d m(x: ${T}) {} }`,
  mret: T => `class K { @d m(x: any): ${T} { return null as any } }`,
};
const TD_KIND_CONTEXTS = { type: Object.keys(TD_CONTEXTS), atype: ["alias", "prop"], mtype: ["alias", "prop", "mparam", "mret"] };
{
  const dir = join(UNIT, "probes", "top-down", "inputs");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".txt")).sort()) {
    const nn = file.slice(0, 2);
    const records = [];
    let current = null;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const m = /^=== (\w+) (\S+)(?: \| (.*))?$/.exec(line);
      if (m) {
        current = { kind: m[1], id: m[2], lines: [], twin: null };
        records.push(current);
        continue;
      }
      if (current === null) continue;
      if (line === "--- twin") {
        current.twin = [];
        continue;
      }
      (current.twin ?? current.lines).push(line);
    }
    for (const r of records) {
      while (r.lines.length > 0 && r.lines[r.lines.length - 1] === "") r.lines.pop();
      const body = r.lines.join("\n");
      const contexts = TD_KIND_CONTEXTS[r.kind];
      if (contexts) {
        for (const ctx of contexts) {
          const deco = ctx === "prop" || ctx === "mparam" || ctx === "mret";
          add(TD_CONTEXTS[ctx](body), `td/${nn}/${r.id}@${ctx}`, { deco, meta: deco && r.kind === "mtype" });
        }
      } else {
        add(body, `td/${nn}/${r.id}`, { tsx: r.kind === "tsx", dts: r.kind === "dts", deco: r.kind === "meta", meta: r.kind === "meta" });
      }
    }
  }
}

// Files with one input per line. "\n" is written as the two characters \n, "#" starts a heading.
function lineFile(path, tag, hints, wrap) {
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim() || raw.startsWith("#")) continue;
    let line = raw;
    const h = { ...hints };
    if (line.startsWith("tsx: ")) {
      line = line.slice(5);
      h.tsx = true;
    } else if (line.startsWith("deco: ")) {
      line = line.slice(6);
      h.deco = true;
    }
    const src = line.replaceAll("\\n", "\n");
    add(wrap ? wrap(src) : src, tag, h);
  }
}

// otg
{
  const dir = join(UNIT, "probes", "outside-type-grammar", "inputs");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".txt")).sort()) {
    const name = file.replace(/\.txt$/, "");
    lineFile(join(dir, file), `otg/${name}`, { tsx: name === "tsx", dts: name === "dts", deco: name === "deco" });
  }
}

// res
{
  const dir = join(UNIT, "ledger", "rescued-tmp");
  for (const sub of ["gct1a-42866", "otg_bottomup_7f3k"]) {
    if (!existsSync(join(dir, sub))) continue;
    for (const file of readdirSync(join(dir, sub)).filter(f => f.endsWith(".txt")).sort()) {
      const name = file.replace(/\.txt$/, "");
      if (name === "ptype_p" || name === "paren.js") continue;
      const wrap = name === "meta-types" ? T => `class K { @d p: ${T}; }` : null;
      lineFile(join(dir, sub, file), `res/${sub}/${name}`, { deco: name.startsWith("deco") || name === "meta-types", dts: name === "dts" }, wrap);
    }
  }
}

// gd
{
  for (const name of ["small", "targeted"]) {
    const path = join(UNIT, "grammar-diff", `corpus.${name}.json`);
    if (!existsSync(path)) continue;
    const corpus = JSON.parse(readFileSync(path, "utf8"));
    for (const f of corpus.forms) {
      for (const [ctx, template] of Object.entries(corpus.contexts)) {
        add(template.replace("%T%", () => f.t), `gd/${name}/${f.prod}@${ctx}${f.mut ? "~" : ""}`, { deco: /@\w/.test(template) });
      }
    }
    for (const s of corpus.sources) add(s.src, `gd/${name}/${s.prod}`, { deco: /^\s*@|[\s({]@\w/.test(s.src) });
  }
}

// JSON input lists of the oracles: strings, [label?, dialect?, text], or {name, file?, text}.
const DIALECT = /^(ts|tsx|js|jsx|mts|cts)$|\.(d\.ts|tsx|ts|jsx|js|mts|cts)$/;
function jsonFile(path, tag, wrap) {
  if (!existsSync(path)) return;
  const list = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(list)) return;
  for (const item of list) {
    let text;
    let dialect = "ts";
    let label = "";
    if (typeof item === "string") text = item;
    else if (Array.isArray(item)) {
      const strings = item.filter(x => typeof x === "string");
      text = strings[strings.length - 1];
      for (const s of strings.slice(0, -1)) {
        if (DIALECT.test(s)) dialect = s;
        else label = s;
      }
    } else if (item && typeof item === "object") {
      text = item.text ?? item.src ?? item.code;
      if (typeof item.file === "string") dialect = item.file;
      label = item.name ?? "";
    }
    if (typeof text !== "string") continue;
    if (/(^|\.)(js|jsx)$/.test(dialect)) continue;
    add(wrap ? wrap(text) : text, `${tag}${label ? "/" + String(label).replace(/\s+/g, "_").slice(0, 60) : ""}`, {
      tsx: /(^|\.)tsx$/.test(dialect),
      dts: /\.d\.ts$/.test(dialect),
    });
  }
}
{
  const lex = join(UNIT, "lexer-lint-hooks");
  for (const t of ["t1", "t2", "t3", "t4", "t5", "t6", "t7"]) jsonFile(join(lex, "bottom-up", `codes-inputs-${t}.json`), `lex/bu-codes-${t}`);
  jsonFile(join(lex, "top-down", "codes-inputs.json"), "lex/td-codes");
  jsonFile(join(lex, "bottom-up", "comments-inputs.json"), "lex/bu-comments");
  jsonFile(join(lex, "top-down", "comments-inputs.json"), "lex/td-comments");
  jsonFile(join(lex, "bottom-up", "pragmas-inputs.json"), "lex/bu-pragmas");
  jsonFile(join(lex, "top-down", "pragma-inputs.json"), "lex/td-pragmas");
  jsonFile(join(UNIT, "sidecar-erased-statements", "top-down", "inputs.json"), "sc/erased-td");
  jsonFile(join(UNIT, "sidecar-erased-statements", "bottom-up", "inputs.json"), "sc/erased-bu");
  jsonFile(join(UNIT, "sidecar-skip-call-sites", "inputs.json"), "sc/skip-sites");
  jsonFile(join(UNIT, "sidecar-skip-call-sites", "bad.json"), "sc/skip-sites-bad");
  const wr = join(UNIT, "sidecar-inline-drops-wrappers", "inputs");
  if (existsSync(wr)) for (const f of readdirSync(wr).filter(f => f.endsWith(".json")).sort()) jsonFile(join(wr, f), `sc/wrappers-${basename(f, ".json")}`);
  jsonFile(join(UNIT, "build-sink-positions", "inputs.json"), "sc/positions");
  jsonFile(join(UNIT, "build-sink", "top-down", "type-inputs.json"), "sc/sink-type", T => `let x: ${T}`);
  jsonFile(join(UNIT, "build-sink", "top-down", "more-inputs.json"), "sc/sink-more");
  jsonFile(join(UNIT, "build-sink", "top-down", "split-inputs.json"), "sc/sink-split");
  const res = join(UNIT, "ledger", "rescued-tmp", "sidecar-probe");
  for (const f of ["inputs.json", "inputs1.json", "inputs2.json", "inputs3.json"]) jsonFile(join(res, f), `sc/rescued-${basename(f, ".json")}`);
  for (const f of ["t2", "t3", "t4", "t5", "t6", "t7"]) jsonFile(join(UNIT, "ledger", "rescued-tmp", "lexhooks", `${f}.json`), `lex/rescued-${f}`);
  jsonFile(join(UNIT, "ledger", "rescued-tmp", "lexhooks", "inputs-codes.json"), "lex/rescued-codes");
  jsonFile(join(UNIT, "ledger", "rescued-tmp", "lexhooks", "inputs-codes2.json"), "lex/rescued-codes2");
  jsonFile(join(UNIT, "ledger", "rescued-tmp", "lexhooks", "extra-inputs.json"), "lex/rescued-extra");
}

// test
if (callsPath && existsSync(callsPath)) {
  for (const line of readFileSync(callsPath, "utf8").split("\n")) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (c.loader !== "ts" && c.loader !== "tsx") continue;
    if (typeof c.code !== "string" || c.code.length > 20000) continue;
    add(c.code, `test/${c.file}:${c.line}`, { tsx: c.loader === "tsx", deco: !!c.deco });
  }
}

let id = 0;
const lines = [];
const setCounts = {};
for (const r of bySrc.values()) {
  const rec = { id: id++, src: r.src, o: r.o, sets: [...r.sets] };
  if (r.tsxAny) rec.tsx = true;
  if (r.tsxAny && r.tsxAll) rec.tsxOnly = true;
  if (r.dts) rec.dts = true;
  if (r.deco) rec.deco = true;
  if (r.meta) rec.meta = true;
  for (const s of r.sets) setCounts[s] = (setCounts[s] ?? 0) + 1;
  lines.push(JSON.stringify(rec));
}
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`corpus: ${lines.length} distinct sources`);
for (const [s, c] of Object.entries(perSet)) console.log(`  ${s.padEnd(5)} inputs ${String(c.inputs).padStart(7)}  first seen in this set ${String(c.fresh).padStart(7)}  distinct sources that carry the set ${String(setCounts[s] ?? 0).padStart(7)}`);
