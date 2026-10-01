// Merges every surviving probe input of the parser unit into one corpus, one row per distinct source text.
//
// usage: bun build-corpus.mjs [--pins <dir of recorded pin logs, default ../pins/recorded>] [--out <corpus.jsonl>]
//
// A row: {"i": n, "src": text, "o": [origin tags], "pin": [pins]?}
// Origin tags (set name, then the detail the set has):
//   p<NN>:<family>             probes/inputs/<NN>-*.mjs                      (tsc-oracle probes, bottom-up)
//   td<NN>:<record id>         probes/top-down/inputs/<NN>-*.txt             (tsc-oracle probes, top-down)
//   otg:<file>                 probes/outside-type-grammar/inputs/*.txt
//   gds:<prod>/<ctx>[/m]       grammar-diff/corpus.small.json               (m: the form is a mutation)
//   gdt:<prod>                 grammar-diff/corpus.targeted.json
//   lex:<file>  side:<file>  bs:<file>                                       lexer hooks, sidecar and build-sink inputs
//   resc:<dir>/<file>          scratch inputs copied from /tmp (ledger/rescued-tmp, ledger/bottom-up/tmp-rescue)
// A pin is a call of an existing test, recorded with the base build (../pins/record-pins.js):
//   "<test file>:<line> <loader> <method> ok"  or  "... E:<first message>"
//   "<test file>:<line> file <path in the bundle>"   for a file of an itBundled case
// Only inputs of a TypeScript loader (ts, tsx) become rows; pins of the js and jsx loaders are counted and left out.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = join(HERE, "..", "..", "..");
const argOf = (name, dflt) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : dflt;
};
const PINS = argOf("--pins", join(HERE, "..", "pins", "recorded"));
const OUT = argOf("--out", join(HERE, "corpus.jsonl"));

const rows = new Map();
const stats = {};
function add(src, origin, pin) {
  if (typeof src !== "string") return;
  const set = origin.split(":")[0];
  stats[set] ??= { inputs: 0, fresh: 0 };
  stats[set].inputs++;
  let row = rows.get(src);
  if (!row) {
    row = { src, o: new Set(), pin: [] };
    rows.set(src, row);
    stats[set].fresh++;
  }
  row.o.add(origin);
  if (pin) row.pin.push(pin);
}

const list = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter(f => re.test(f)).sort().map(f => join(dir, f)) : []);
const warnMissing = p => {
  if (!existsSync(p)) console.error("missing: " + p);
  return existsSync(p);
};

// 1. probes/inputs/*.mjs
for (const file of list(join(UNIT, "probes", "inputs"), /^\d\d-.*\.mjs$/)) {
  const group = (await import(file)).default;
  const nn = basename(file).slice(0, 2);
  for (const c of group.cases) add(c.src, `p${nn}:${c.fam}`);
}

// 2. probes/top-down/inputs/*.txt
{
  const runner = join(UNIT, "probes", "top-down", "runner.mjs");
  if (warnMissing(runner)) {
    const { TYPE_CONTEXTS, ATYPE_CONTEXTS, MTYPE_CONTEXTS } = await import(runner);
    for (const file of list(join(UNIT, "probes", "top-down", "inputs"), /\.txt$/)) {
      const nn = basename(file).slice(0, 2);
      let rec = null;
      const flush = () => {
        if (!rec) return;
        const bodies = rec.lines.join("\n").split("\n--- twin\n");
        const body = bodies[0];
        if (rec.kind === "type" || rec.kind === "atype" || rec.kind === "mtype") {
          const ctxs = rec.kind === "type" ? Object.keys(TYPE_CONTEXTS) : rec.kind === "atype" ? ATYPE_CONTEXTS : MTYPE_CONTEXTS;
          for (const ctx of ctxs) add(TYPE_CONTEXTS[ctx](body), `td${nn}:${rec.id}@${ctx}`);
        } else {
          add(body, `td${nn}:${rec.id}`);
          if (bodies[1] !== undefined) add(bodies[1], `td${nn}:${rec.id}~twin`);
        }
      };
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^=== (\S+) (.*)$/.exec(line);
        if (m) {
          flush();
          rec = { kind: m[1], id: m[2], lines: [] };
        } else if (rec) rec.lines.push(line);
      }
      flush();
    }
  }
}

// 3. line lists: one input per line, the two characters \n stand for a line break, "#" starts a comment line.
const TYPE_WRAPS = [T => `type X = ${T};`, T => `class C { @d p: ${T}; }`, T => `class C { @d m(a: ${T}): ${T} { throw 0 } }`];
function lineList(file, origin, asTypes) {
  if (!warnMissing(file)) return;
  for (let line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    line = line.replace(/^(tsx|deco): /, "").replaceAll("\u23CE", "\n").replaceAll("\\n", "\n");
    if (asTypes) for (const w of TYPE_WRAPS) add(w(line), origin);
    else add(line, origin);
  }
}
for (const f of list(join(UNIT, "probes", "outside-type-grammar", "inputs"), /\.txt$/)) lineList(f, "otg:" + basename(f, ".txt"));
const RESCUE = [join(UNIT, "ledger", "rescued-tmp"), join(UNIT, "ledger", "bottom-up", "tmp-rescue"), "/tmp"];
const rescued = (dir, file) => RESCUE.map(r => join(r, dir, file)).find(existsSync) ?? join(RESCUE[0], dir, file);
const rescuedList = (dir, re) => {
  const names = new Set();
  for (const r of RESCUE) for (const f of list(join(r, dir), re)) names.add(basename(f));
  return [...names].sort().map(n => rescued(dir, n));
};
for (const f of rescuedList("gct1a-42866", /\.txt$/)) {
  const b = basename(f);
  if (b === "rows.txt" || b === "ptype_p.txt") continue;
  lineList(f, "resc:gct1a-42866/" + b, b === "meta-types.txt");
}
for (const f of rescuedList("otg_bottomup_7f3k", /\.txt$/)) lineList(f, "resc:otg_bottomup_7f3k/" + basename(f));
for (const f of rescuedList("gotg", /^t0\.txt$/)) lineList(f, "resc:gotg/" + basename(f));
for (const f of rescuedList("gte-probe", /^(in\d+|types.*)\.txt$/)) lineList(f, "resc:gte-probe/" + basename(f), basename(f).startsWith("types"));

// 4. JSON inputs of the smaller probes. A source is a string of the top array, the last string of an inner array,
//    or the "text" / "src" / "code" of an object. An entry that names a JavaScript loader or file is left out.
const JS_HINT = /^(js|jsx|mjs|cjs)$/;
function jsonList(file, origin, asTypes) {
  if (!warnMissing(file)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error("not JSON: " + file);
    return;
  }
  if (!Array.isArray(data)) data = data.inputs ?? data.cases ?? data.tests ?? [];
  const put = s => {
    if (asTypes) for (const w of TYPE_WRAPS) add(w(s), origin);
    else add(s, origin);
  };
  for (const e of data) {
    if (typeof e === "string") put(e);
    else if (Array.isArray(e)) {
      const strings = e.filter(x => typeof x === "string");
      if (!strings.length || strings.slice(0, -1).some(x => JS_HINT.test(x))) continue;
      put(strings[strings.length - 1]);
    } else if (e && typeof e === "object") {
      const s = e.text ?? e.src ?? e.code ?? e.input;
      const file = String(e.file ?? e.loader ?? "");
      if (/\.(js|jsx|mjs|cjs)$/.test(file) || JS_HINT.test(file)) continue;
      if (typeof s === "string") put(s);
    }
  }
}
for (const f of list(join(UNIT, "lexer-lint-hooks", "bottom-up"), /-inputs.*\.json$/)) jsonList(f, "lex:bu/" + basename(f, ".json"));
for (const f of list(join(UNIT, "lexer-lint-hooks", "top-down"), /-inputs.*\.json$/)) jsonList(f, "lex:td/" + basename(f, ".json"));
jsonList(join(UNIT, "sidecar-skip-call-sites", "inputs.json"), "side:skip-call-sites/inputs");
jsonList(join(UNIT, "sidecar-skip-call-sites", "bad.json"), "side:skip-call-sites/bad");
jsonList(join(UNIT, "sidecar-erased-statements", "top-down", "inputs.json"), "side:erased/td");
jsonList(join(UNIT, "sidecar-erased-statements", "bottom-up", "inputs.json"), "side:erased/bu");
for (const f of list(join(UNIT, "sidecar-inline-drops-wrappers", "inputs"), /\.json$/)) jsonList(f, "side:wrappers/" + basename(f, ".json"));
jsonList(join(UNIT, "build-sink-positions", "inputs.json"), "bs:positions");
jsonList(join(UNIT, "build-sink", "top-down", "more-inputs.json"), "bs:more");
jsonList(join(UNIT, "build-sink", "top-down", "split-inputs.json"), "bs:split");
jsonList(join(UNIT, "build-sink", "top-down", "type-inputs.json"), "bs:type", true);
for (const f of rescuedList("lexhooks", /^(t\d+|inputs-codes\d*|extra-inputs|comments-inputs|pragma-inputs)\.json$/)) jsonList(f, "resc:lexhooks/" + basename(f));
for (const f of rescuedList("sidecar-probe", /^inputs\d*\.json$/)) jsonList(f, "resc:sidecar-probe/" + basename(f));
for (const f of rescuedList("erased-bu-7f3a", /^(in\d+|s1|tests\.probe)\.json$/)) jsonList(f, "resc:erased-bu-7f3a/" + basename(f));
for (const f of rescuedList("erased-probe", /^(in\d+|smoke)\.json$/)) jsonList(f, "resc:erased-probe/" + basename(f));
for (const f of rescuedList("erased-research", /^inputs\d*\.json$/)) jsonList(f, "resc:erased-research/" + basename(f));
for (const f of rescuedList("parser-research", /\.json$/)) jsonList(f, "resc:parser-research/" + basename(f));
for (const f of rescuedList("gte", /^[cop]\d+\.json$/)) jsonList(f, "resc:gte/" + basename(f));
for (const f of rescuedList("gte", /^m\d+\.json$/)) jsonList(f, "resc:gte/" + basename(f), true);

// 5. grammar-diff corpora
for (const name of ["small", "targeted"]) {
  const file = join(UNIT, "grammar-diff", `corpus.${name}.json`);
  if (!warnMissing(file)) continue;
  const c = JSON.parse(readFileSync(file, "utf8"));
  const tag = name === "small" ? "gds" : "gdt";
  for (const form of c.forms) {
    for (const [ctx, tpl] of Object.entries(c.contexts)) add(tpl.replace("%T%", () => form.t), `${tag}:${form.prod}/${ctx}${form.mut ? "/m" : ""}`);
  }
  for (const s of c.sources) add(s.src, `${tag}:${s.prod}`);
}

// 6. pins: calls of the existing tests, recorded with the base build
const pinStats = { calls: 0, typescript: 0, javascript: 0, noText: 0, bundleFiles: 0, bundleTsFiles: 0 };
const short = f => f.replace(/^.*?\/test\//, "test/");
for (const file of list(PINS, /\.jsonl(\.gz)?$/)) {
  const raw = file.endsWith(".gz") ? gunzipSync(readFileSync(file)).toString("utf8") : readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    const at = short(r.frames?.[r.frames.length - 1] ?? "?");
    if (r.m === "itBundled") {
      for (const [path, text] of Object.entries(r.files ?? {})) {
        pinStats.bundleFiles++;
        if (!/\.[cm]?tsx?$/.test(path)) continue;
        pinStats.bundleTsFiles++;
        const errs = r.bundleErrors?.[path];
        add(text, "pinfile:" + basename(at.split(":")[0]), `${at} file ${path}${errs ? " E:" + JSON.stringify(errs) : ""}`);
      }
      continue;
    }
    pinStats.calls++;
    if (typeof r.code !== "string") {
      pinStats.noText++;
      continue;
    }
    const loader = r.arg ?? r.opts?.loader ?? "jsx";
    if (loader !== "ts" && loader !== "tsx") {
      pinStats.javascript++;
      continue;
    }
    pinStats.typescript++;
    add(r.code, "pin:" + basename(at.split(":")[0]), `${at} ${loader} ${r.m} ${r.ok ? "ok" : "E:" + (r.err?.[0] ?? "")}`);
  }
}

let i = 0;
const out = [];
for (const row of rows.values()) {
  const rec = { i: i++, src: row.src, o: [...row.o] };
  if (row.pin.length) rec.pin = [...new Set(row.pin)];
  out.push(JSON.stringify(rec));
}
writeFileSync(OUT, out.join("\n") + "\n");
const lines = ["set\tinputs\tfirst seen here"];
for (const [set, s] of Object.entries(stats)) lines.push(`${set}\t${s.inputs}\t${s.fresh}`);
lines.push(`total distinct\t${rows.size}`);
lines.push("pins\t" + JSON.stringify(pinStats));
writeFileSync(OUT.replace(/\.jsonl$/, "") + ".stats.tsv", lines.join("\n") + "\n");
console.log(lines.join("\n"));
