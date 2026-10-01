// Joins the outputs of classify.mjs and writes the tables of the ledger.
//
// usage: bun report.mjs <corpus.jsonl> <work dir of classify.mjs> <out dir>
//
// Views: ts (bun loader ts, tsc /input.ts), tsx (loader tsx, /input.tsx), deco (loader ts with experimentalDecorators +
// emitDecoratorMetadata, /input.ts, checker with experimentalDecorators), dts (loader ts, /input.d.ts).
// Classes per view:  AA both accept   B bun accepts, tsc's parser rejects   A bun rejects, tsc parses clean
//                    RR both reject   CRASH the bun side died on the input
// Set A is split three ways, because the earlier probes used different rules:
//   G (probes/run.mjs)   A2: the checker reports a code of the grammar ranges (<2000, 8xxx, 17xxx, 18xxx)
//                        A1s: no such code, and a code of STRUCTURAL (probes/report.mjs)     A1c: the rest
//   N (name resolution)  A1: every checker code is a name-resolution code (NR)   A2: as G   A3: the rest
//   R (used for the split) A2: as G   A3: a code of SHAPE   A1: the rest (see SHAPE below)
//   V (lost probe.mjs)   A1: every checker code is in VH (its "environment noise" list)   A2: as G   A3: the rest
// Files written: see the list at the end of this file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const [corpusPath, work, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const isGrammar = c => c < 2000 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
const STRUCTURAL = new Set([
  2207, 2206, 2300, 2331, 2332, 2337, 2357, 2364, 2369, 2371, 2391, 2452, 2462, 2480, 2483, 2499, 2500, 2660, 2669, 2670, 2680,
  2730, 2784, 2842, 2857, 2858, 5084, 5085, 5086, 5087, 5088, 7061,
]);
// Cannot find name / namespace / module / global type, "only refers to a type", "refers to a value", missing lib or helper.
const NR = new Set([
  2304, 2552, 2503, 2307, 2792, 2318, 2468, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593, 2686, 2693, 2694, 2749, 2867, 2868, 2874,
  2875, 2879, 2882, 7026, 2354, 2343,
]);
const VH = new Set([2304, 2307, 2318, 2322, 2339, 2355, 2503, 2552, 2554, 2580, 2584, 2693, 2697, 2711, 2749]);
// Rule R, the one the split below uses: A2 as above; A3 when a code says that the SHAPE of a declaration is wrong
// (STRUCTURAL plus the redeclaration and merge codes); A1 for the rest: name resolution and type noise of a small
// snippet (implicit any 70xx, 2564, 2339, 2322, ...). Rule N puts 363 rows of the ts view into A3 for such noise alone.
const SHAPE = new Set([...STRUCTURAL, 2323, 2335, 2395, 2440, 2451, 2567, 2813]);
// Class A1 of rule R is split once more:
//   A1j  tsc's JavaScript for the row does not parse with the js loader of the bun side (an early error of JavaScript
//        that tsc does not report: accepting the row would print code that does not run)
//   A1r  an unresolved name of the row is a reserved word (tsc and typescript-go read `let x: if` as a type reference)
//   A1v  the rest: valid TypeScript that the bun side rejects. This is the worklist.
const NAME_CODES = new Set([2304, 2552, 2503, 2693, 2694, 2749]);
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends finally for function if import in instanceof new return super switch throw try var while with".split(
    " ",
  ),
);

const VIEWS = { ts: [0, "ts"], tsx: [1, "tsx"], deco: [2, "ts"], dts: [0, "dts"] };
const VIEW_NAMES = Object.keys(VIEWS);

const readLines = p =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
const corpus = readLines(corpusPath);
const info1 = JSON.parse(readFileSync(join(work, "stage1.info.json"), "utf8"));
const info2 = existsSync(join(work, "stage2.info.json")) ? JSON.parse(readFileSync(join(work, "stage2.info.json"), "utf8")) : null;
const shards = (mode, jobs) => {
  const m = new Map();
  for (let s = 0; s < jobs; s++) {
    const p = join(work, `${mode}.${s}.jsonl`);
    if (!existsSync(p)) continue;
    for (const r of readLines(p)) if (!r.done) m.set(r.i, r);
  }
  return m;
};
const bun = shards("bun", info1.jobs);
const tsc = shards("tsc", info1.jobs);
const s2 = info2 ? shards("s2", info2.jobs) : new Map();
const go = new Map();
if (existsSync(join(work, "go.jsonl"))) for (const r of readLines(join(work, "go.jsonl"))) go.set(r.i, r.g);

const setOf = o => o.split(":")[0].replace(/\d+$/, "");
const normBun = m =>
  m
    .replace(/but found "(?:[^"\\]|\\.)*"$/, "but found <token>")
    .replace(/^Unexpected (?!end of file).*$/, "Unexpected <token>")
    .replace(/^"[^"]*" is a reserved word/, "<word> is a reserved word")
    .replace(/^Cannot use "[^"]*" as an identifier here/, "Cannot use <word> as an identifier here")
    .replace(/^Syntax error "[^"]*"$/, "Syntax error <char>")
    .replace(/"[A-Za-z_$][\w$]*" has already been declared/, "<name> has already been declared");
const short = (s, n = 110) => (JSON.stringify(s).length > n ? JSON.stringify(s).slice(0, n) + "…" : JSON.stringify(s));
const tsv = v => String(v ?? "").replaceAll("\t", " ").replaceAll("\n", "\\n");
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const lineCol = (src, start) => {
  let line = 1;
  let last = -1;
  for (let i = 0; i < start && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return [line, start - last];
};

// ───────────── per row ─────────────
const table = [];
const totals = {}; // view -> class -> n
const bySet = {}; // set -> view -> class -> n
const A = []; // set A entries
const B = [];
const goDiff = { verdict: [], first: [], later: [], count: 0, panic: [], rows: 0, same: 0, dtsDiffers: { tsc: 0, go: 0 } };
const firstCodes = [];
const posAgree = { rr: 0, same: 0, sameLine: 0 };
const bunMsgToCode = {}; // normalized bun message -> tsc code -> n   (RR rows, view ts)
const crashes = [];

for (const row of corpus) {
  const b = bun.get(row.i);
  const t = tsc.get(row.i)?.t;
  const g = go.get(row.i);
  const v = s2.get(row.i)?.v;
  table.push(JSON.stringify({ i: row.i, b: b.crash ? "CRASH" : b.b, t, g, v }));
  const sets = [...new Set(row.o.map(setOf))];
  if (b.crash) crashes.push({ i: row.i, src: row.src, crash: b.crash, o: row.o });
  const cls = {};
  for (const view of VIEW_NAMES) {
    const [slot, dialect] = VIEWS[view];
    const tscOk = t[dialect][0] === 0;
    let c;
    if (b.crash) c = "CRASH";
    else {
      const bunOk = b.b[slot] === 1;
      c = bunOk ? (tscOk ? "AA" : "B") : tscOk ? "A" : "RR";
    }
    cls[view] = c;
    inc((totals[view] ??= {}), c);
    for (const s of sets) inc(((bySet[s] ??= {})[view] ??= {}), c);
  }
  // set A
  const aViews = VIEW_NAMES.filter(x => cls[x] === "A");
  if (aViews.length) {
    const e = { row, views: {}, bun: b.b };
    for (const view of aViews) {
      const one = v?.[view] ?? { c: [], m: {}, missing: true };
      const codes = [...new Set(one.c.map(x => x[0]))].sort((x, y) => x - y);
      const gr = codes.filter(isGrammar);
      const rest = codes.filter(c => !isGrammar(c));
      const G = gr.length ? "A2" : rest.some(c => STRUCTURAL.has(c)) ? "A1s" : "A1c";
      const N = gr.length ? "A2" : rest.every(c => NR.has(c)) ? "A1" : "A3";
      const V = gr.length ? "A2" : rest.every(c => VH.has(c)) ? "A1" : "A3";
      const R = gr.length ? "A2" : rest.some(c => SHAPE.has(c)) ? "A3" : "A1";
      const reserved = one.c.some(x => NAME_CODES.has(x[0]) && RESERVED.has(row.src.slice(x[1], x[1] + x[2])));
      const sub = R !== "A1" ? R : one.js !== 1 && one.js !== undefined ? "A1j" : reserved ? "A1r" : "A1v";
      const goOk = g ? g[VIEWS[view][1]][0] === 0 : null;
      e.views[view] = { codes, G, N, V, R, sub, goOk, js: one.js, m: one.m, msg: b.b[VIEWS[view][0]][0], threw: one.threw };
    }
    A.push(e);
  }
  const bViews = VIEW_NAMES.filter(x => cls[x] === "B");
  if (bViews.length) B.push({ row, views: bViews, t, g });
  if (JSON.stringify(t.dts) !== JSON.stringify(t.ts)) goDiff.dtsDiffers.tsc++;
  if (g && JSON.stringify(g.dts) !== JSON.stringify(g.ts)) goDiff.dtsDiffers.go++;
  // tsc against typescript-go, per dialect
  if (g) {
    for (const d of ["ts", "tsx", "dts"]) {
      goDiff.rows++;
      const tt = t[d];
      const gg = g[d];
      if (gg[0] === "panic" || gg[0] === "crash") {
        goDiff.panic.push({ i: row.i, d, src: row.src, go: gg, tsc: tt });
        continue;
      }
      const tOk = tt[0] === 0;
      const gOk = gg[0] === 0;
      if (tOk !== gOk) goDiff.verdict.push({ i: row.i, d, src: row.src, tsc: tt, go: gg, o: row.o });
      else if (!tOk && JSON.stringify(tt[2]) !== JSON.stringify(gg[2])) goDiff.first.push({ i: row.i, d, src: row.src, tsc: tt, go: gg });
      else if (JSON.stringify(tt.slice(2)) !== JSON.stringify(gg.slice(2)) || tt[0] !== gg[0]) {
        goDiff.count++;
        goDiff.later.push({ i: row.i, d, src: row.src, tsc: tt, go: gg });
      }
      else goDiff.same++;
    }
  }
  // first codes of rejected inputs (view ts, and view tsx when its first diagnostic differs)
  for (const d of ["ts", "tsx"]) {
    const tt = t[d];
    if (tt[0] === 0 || tt[0] === "threw") continue;
    if (d === "tsx" && JSON.stringify(tt) === JSON.stringify(t.ts)) continue;
    const slot = d === "ts" ? 0 : 1;
    const bb = b.crash ? "CRASH" : b.b[slot];
    const gg = g?.[d];
    firstCodes.push(
      [row.i, d, tt[0], tt[2][0], tt[2][1], tt[2][2], gg && gg[2] ? gg[2].join(",") : gg ? String(gg[0]) : "", bb === 1 ? "ok" : bb === "CRASH" ? "CRASH" : tsv(bb[0]), bb === 1 || bb === "CRASH" ? "" : `${bb[1]}:${bb[2]}`, tsv(row.src)].join(
        "\t",
      ),
    );
    if (d === "ts" && bb !== 1 && bb !== "CRASH") {
      posAgree.rr++;
      const [line, col] = lineCol(row.src, tt[2][1]);
      if (line === bb[1] && col === bb[2]) posAgree.same++;
      else if (line === bb[1]) posAgree.sameLine++;
      inc((bunMsgToCode[normBun(bb[0])] ??= {}), tt[2][0]);
    }
  }
}

const w = (name, text) => writeFileSync(join(outDir, name), text.endsWith("\n") ? text : text + "\n");
const wz = (name, text) => writeFileSync(join(outDir, name), gzipSync(text, { level: 9 }));
wz("table.jsonl.gz", table.join("\n") + "\n");

// ───────────── totals ─────────────
{
  const L = [];
  L.push(`bun side: ${info1.bun}  sha256 ${info1.execSha256}  (${info1.execPath})`);
  L.push(`tsc ${info1.typescript}; typescript-go oracle sha256 ${info1.tsgoSha256 ?? "-"}`);
  L.push(`corpus: ${corpus.length} distinct sources, sha256 ${info1.corpusSha256}`);
  L.push("");
  L.push("view\tAA\tB\tA\tRR\tCRASH");
  for (const view of VIEW_NAMES) L.push([view, ...["AA", "B", "A", "RR", "CRASH"].map(c => totals[view][c] ?? 0)].join("\t"));
  L.push("");
  L.push("per input set (a source that several sets hold counts in each)");
  L.push("set\tview\tAA\tB\tA\tRR\tCRASH");
  for (const s of Object.keys(bySet).sort()) for (const view of VIEW_NAMES) L.push([s, view, ...["AA", "B", "A", "RR", "CRASH"].map(c => bySet[s][view]?.[c] ?? 0)].join("\t"));
  L.push("");
  L.push("inputs that kill the bun side:");
  for (const c of crashes) L.push(`  #${c.i} ${short(c.src, 200)}  signal=${c.crash.signal} exit=${c.crash.exitCode}  ${c.o.join(" ")}`);
  w("totals.txt", L.join("\n"));
}

// ───────────── set A ─────────────
{
  const L = [];
  const rowsOut = ["i\tview\tG\tR (A1 split)\tV\ttypescript-go\tchecker codes\ttsc emit parses as js\tbun first message\tpins\torigins\tsource"];
  for (const view of VIEW_NAMES) {
    const es = A.filter(e => e.views[view]);
    const cG = {};
    const cN = {};
    const cV = {};
    const cS = {};
    const cR = {};
    const cGo = {};
    const cross = {};
    const js = {};
    for (const e of es) {
      const x = e.views[view];
      inc(cG, x.G);
      inc(cN, x.N);
      inc(cV, x.V);
      inc(cS, x.sub);
      inc(cR, x.R);
      if (x.goOk === false) inc(cGo, x.sub);
      inc(cross, `G=${x.G} N=${x.N} V=${x.V} R=${x.R}`);
      inc(js, `${x.R} js=${x.js === 1 ? "parses" : x.js === null ? "emit threw" : x.js === undefined ? "n/a" : "REJECTED"}`);
      rowsOut.push(
        [e.row.i, view, x.G, x.sub, x.V, x.goOk === false ? "go rejects" : "", x.codes.join(","), x.js === 1 ? "yes" : x.js === undefined ? "" : x.js === null ? "emit threw" : "no: " + tsv(x.js[0]), tsv(x.msg), tsv((e.row.pin ?? []).join(" | ")), e.row.o.slice(0, 4).join(" "), tsv(e.row.src)].join("\t"),
      );
    }
    L.push(`==== view ${view}: set A = ${es.length} rows`);
    L.push(`  rule G: ${JSON.stringify(cG)}`);
    L.push(`  rule N: ${JSON.stringify(cN)}`);
    L.push(`  rule V: ${JSON.stringify(cV)}`);
    L.push(`  rule R: ${JSON.stringify(cR)}`);
    L.push(`  rule R with A1 split (A1v worklist, A1r reserved word as a name, A1j tsc's JavaScript does not parse): ${JSON.stringify(cS)}`);
    L.push(`  of these, rows that the parser of typescript-go rejects: ${JSON.stringify(cGo)}`);
    L.push("  cross table:");
    for (const [k, n] of Object.entries(cross).sort((a, b) => b[1] - a[1])) L.push(`    ${String(n).padStart(6)}  ${k}`);
    L.push("  does the JavaScript that tsc prints parse with the js loader of the bun side (by class of rule R):");
    for (const [k, n] of Object.entries(js).sort()) L.push(`    ${String(n).padStart(6)}  ${k}`);
    L.push("");
  }
  w("setA.classes.txt", L.join("\n"));
  wz("setA.rows.tsv.gz", rowsOut.join("\n") + "\n");

  // which codes decide the class: rows of view ts without a grammar code, by code outside NR
  for (const view of ["ts", "tsx", "deco"]) {
    const codes = {};
    for (const e of A) {
      const x = e.views[view];
      if (!x) continue;
      for (const c of x.codes) {
        const k = (codes[c] ??= { rows: 0, onlyNonNR: 0, msg: x.m[c], grammar: isGrammar(c), nr: NR.has(c), vh: VH.has(c), structural: STRUCTURAL.has(c), ex: [] });
        k.rows++;
        if (k.ex.length < 2) k.ex.push(e.row.src);
        const others = x.codes.filter(o => o !== c && !NR.has(o));
        if (!others.length && !NR.has(c)) k.onlyNonNR++;
      }
    }
    const T = ["code\trows of set A with it\trows where it is the only code outside NR\tgrammar range\tin NR\tin VH\tin STRUCTURAL\tmessage\texample"];
    for (const [c, k] of Object.entries(codes).sort((a, b) => b[1].rows - a[1].rows))
      T.push([c, k.rows, k.onlyNonNR, k.grammar ? "y" : "", k.nr ? "y" : "", k.vh ? "y" : "", k.structural ? "y" : "", tsv(k.msg), tsv(k.ex[0])].join("\t"));
    w(`setA.codes.${view}.tsv`, T.join("\n"));
  }

  // causes: the first message of the bun side, per class of rule N
  for (const view of ["ts", "tsx", "deco"]) {
    const clusters = {};
    for (const e of A) {
      const x = e.views[view];
      if (!x) continue;
      const k = (clusters[normBun(x.msg)] ??= { n: 0, N: {}, G: {}, js: 0, fams: {}, ex: { A1v: [], A1r: [], A1j: [], A2: [], A3: [] }, pins: 0, codes: {} });
      k.n++;
      inc(k.N, x.sub);
      inc(k.G, x.G);
      if (x.js === 1) k.js++;
      if (e.row.pin) k.pins++;
      if (x.sub === "A1v") for (const o of e.row.o) inc(k.fams, o.replace(/@.*$/, "").replace(/\/m$/, ""));
      for (const c of x.codes) if (!NR.has(c)) inc(k.codes, c);
      k.ex[x.sub].push(e.row.src);
    }
    const L2 = [`set A by cause, view ${view}: the first message of the bun side (token text replaced). R: classes of rule R, A1 split. Sorted by A1v.`, ""];
    for (const [msg, k] of Object.entries(clusters).sort((a, b) => (b[1].N.A1v ?? 0) - (a[1].N.A1v ?? 0) || b[1].n - a[1].n)) {
      L2.push(`${String(k.n).padStart(6)}  ${msg}`);
      L2.push(`        R: A1v=${k.N.A1v ?? 0} A1r=${k.N.A1r ?? 0} A1j=${k.N.A1j ?? 0} A2=${k.N.A2 ?? 0} A3=${k.N.A3 ?? 0}   G: A1c=${k.G.A1c ?? 0} A1s=${k.G.A1s ?? 0} A2=${k.G.A2 ?? 0}   tsc's emit parses as js: ${k.js}   rows with a pin: ${k.pins}`);
      const codes = Object.entries(k.codes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}x${n}`).join(" ");
      if (codes) L2.push(`        checker codes outside NR: ${codes}`);
      if (k.N.A1v) L2.push(`        origins of A1v: ${Object.entries(k.fams).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => `${f}x${n}`).join(" ")}`);
      for (const c of ["A1v", "A1r", "A1j", "A2", "A3"]) {
        const ex = k.ex[c].sort((a, b) => a.length - b.length).slice(0, c === "A1v" ? 8 : 3);
        if (ex.length) L2.push(`        ${c}: ${ex.map(s => short(s, 90)).join("   ")}`);
      }
    }
    w(`setA.causes.${view}.txt`, L2.join("\n"));
  }
}

// ───────────── set A: worklist by origin ─────────────
{
  // probes/inputs/*.mjs name, per family, the place in Bun and the production of the reference parser.
  const fam = {};
  const probeInputs = process.env.PROBE_INPUTS ?? "/workspace/notes/lint/units/parser/probes/inputs";
  if (existsSync(probeInputs)) {
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(probeInputs).filter(f => /^\d\d-.*\.mjs$/.test(f))) {
      try {
        const mod = await import(join(probeInputs, f));
        for (const [name, v] of Object.entries(mod.families ?? {})) fam[`p${f.slice(0, 2)}:${name}`] = v;
      } catch {}
    }
  }
  for (const view of ["ts", "tsx", "deco"]) {
    const keys = {};
    for (const e of A) {
      const x = e.views[view];
      if (!x) continue;
      for (const o of new Set(e.row.o.map(o => o.replace(/@.*$/, "").replace(/\/m$/, "").replace(/^(td\d\d:[^.]+\.[^.]+).*$/, "$1")))) {
        const k = (keys[o] ??= { c: {}, msgs: {}, ex: [], go: 0 });
        inc(k.c, x.sub);
        if (x.sub === "A1v") {
          inc(k.msgs, x.msg);
          k.ex.push(e.row.src);
          if (x.goOk === false) k.go++;
        }
      }
    }
    const T = ["origin\tA1v\tA1r\tA1j\tA2\tA3\tA1v rows typescript-go rejects\tplace in bun\tproduction of the reference\tfirst messages of bun for A1v\texamples of A1v"];
    for (const [o, k] of Object.entries(keys).sort((a, b) => (b[1].c.A1v ?? 0) - (a[1].c.A1v ?? 0))) {
      if (!k.c.A1v) continue;
      T.push(
        [
          o,
          k.c.A1v ?? 0,
          k.c.A1r ?? 0,
          k.c.A1j ?? 0,
          k.c.A2 ?? 0,
          k.c.A3 ?? 0,
          k.go,
          tsv(fam[o]?.bun ?? ""),
          tsv(fam[o]?.ref ?? ""),
          tsv(Object.entries(k.msgs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, n]) => `${m} x${n}`).join(" | ")),
          tsv(k.ex.sort((a, b) => a.length - b.length).slice(0, 5).join("   ‖   ")),
        ].join("\t"),
      );
    }
    w(`setA.worklist.${view}.tsv`, T.join("\n"));
  }
}

// ───────────── set B ─────────────
{
  const rowsOut = ["i\tviews\ttsc count\ttsc first code\tstart\tlength\ttsc first message\ttypescript-go first\tpins\torigins\tsource"];
  for (const view of ["ts", "tsx", "deco", "dts"]) {
    const clusters = {};
    let n = 0;
    for (const e of B) {
      if (!e.views.includes(view)) continue;
      n++;
      const tt = e.t[VIEWS[view][1]];
      const k = (clusters[tt[2][0]] ??= { n: 0, msgs: {}, fams: {}, ex: [], pins: 0, goSame: 0 });
      k.n++;
      inc(k.msgs, tt[1]);
      if (e.row.pin) k.pins++;
      const gg = e.g?.[VIEWS[view][1]];
      if (gg && JSON.stringify(gg[2]) === JSON.stringify(tt[2])) k.goSame++;
      for (const o of e.row.o) inc(k.fams, o.replace(/@.*$/, "").replace(/\/m$/, ""));
      k.ex.push(e.row.src);
    }
    const L = [`set B by cause, view ${view}: ${n} rows. The bun side accepts, the parser of tsc rejects. Key: the first code of tsc.`, ""];
    for (const [code, k] of Object.entries(clusters).sort((a, b) => b[1].n - a[1].n)) {
      L.push(`${String(k.n).padStart(6)}  TS${code}   typescript-go gives the same first diagnostic: ${k.goSame}   rows with a pin: ${k.pins}`);
      L.push(`        messages: ${Object.entries(k.msgs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, c]) => `${m} x${c}`).join("   ")}`);
      L.push(`        origins: ${Object.entries(k.fams).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, c]) => `${f}x${c}`).join(" ")}`);
      L.push(`        ${k.ex.sort((a, b) => a.length - b.length).slice(0, 5).map(s => short(s, 80)).join("   ")}`);
    }
    w(`setB.causes.${view}.txt`, L.join("\n"));
  }
  for (const e of B) {
    const d = VIEWS[e.views[0]][1];
    const tt = e.t[d];
    const gg = e.g?.[d];
    rowsOut.push([e.row.i, e.views.join(","), tt[0], tt[2][0], tt[2][1], tt[2][2], tsv(tt[1]), gg && gg[2] ? gg[2].join(",") : gg ? String(gg[0]) : "", tsv((e.row.pin ?? []).join(" | ")), e.row.o.slice(0, 4).join(" "), tsv(e.row.src)].join("\t"));
  }
  wz("setB.rows.tsv.gz", rowsOut.join("\n") + "\n");
}

// ───────────── tsc against typescript-go ─────────────
{
  const L = [];
  L.push(`rows x dialects compared: ${goDiff.rows}`);
  L.push(`identical (count and the first six [code, start, length]): ${goDiff.same}`);
  L.push(`same verdict and same first diagnostic, later diagnostics or the count differ: ${goDiff.count}`);
  L.push(`both reject, the first diagnostic differs: ${goDiff.first.length}`);
  L.push(`verdict differs: ${goDiff.verdict.length}`);
  L.push(`typescript-go panicked or died: ${goDiff.panic.length}`);
  L.push(`rows whose parse diagnostics as input.d.ts differ from those as input.ts: tsc ${goDiff.dtsDiffers.tsc}, typescript-go ${goDiff.dtsDiffers.go}`);
  L.push("");
  const dirs = {};
  for (const x of goDiff.verdict) inc(dirs, `${x.d}: ${x.tsc[0] === 0 ? "tsc accepts, typescript-go rejects with TS" + x.go[2][0] : "typescript-go accepts, tsc rejects with TS" + x.tsc[2][0]}`);
  L.push("verdict differs, by dialect and direction:");
  for (const [k, n] of Object.entries(dirs).sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(6)}  ${k}`);
  L.push("");
  const pairs = {};
  for (const x of goDiff.first) {
    const kind = x.tsc[2][0] !== x.go[2][0] ? `code TS${x.tsc[2][0]} -> TS${x.go[2][0]}` : `same code TS${x.tsc[2][0]}, span differs`;
    const k = (pairs[kind] ??= { n: 0, ex: [] });
    k.n++;
    if (k.ex.length < 3) k.ex.push(x);
  }
  L.push("both reject, first diagnostic differs (tsc -> typescript-go), with examples [code,start,length]:");
  for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1].n - a[1].n)) {
    L.push(`  ${String(v.n).padStart(6)}  ${k}`);
    for (const x of v.ex) L.push(`            ${x.d} ${short(x.src, 80)}  tsc ${JSON.stringify(x.tsc[2])} go ${JSON.stringify(x.go[2])}`);
  }
  w("tsc-vs-tsgo.summary.txt", L.join("\n"));
  // Every disagreement gets a cause. The order matters: the first pattern that matches owns the row.
  const CAUSES = [
    ["typeof-private-name", x => /typeof\s+[\w$.]*#/.test(x.src)],
    ["import-assert (TS2880 from the parser of typescript-go)", x => x.go[2]?.[0] === 2880 || x.tsc[2]?.[0] === 2880 || /\bassert\s*[:{]/.test(x.src)],
    ["reference-directive", x => /<reference/.test(x.src)],
    ["modifier-before-rest-parameter", x => /\b(public|private|protected|readonly|override)\s+\.\.\./.test(x.src)],
    ["jsdoc-function-type", x => /\bfunction\s*[(<.]/.test(x.src) || /[:<=|&(\[,]\s*function\b\s*[;,>)\]|&=]/.test(x.src)],
    ["await-as-declaration-name", x => /\b(type|interface|class|enum|namespace|module)\s+await\b/.test(x.src)],
    ["as-or-satisfies-then-operator", x => /\b(as|satisfies)\b/.test(x.src) && x.tsc[0] === 0 && x.go[2]?.[0] === 1005],
    ["numeric-literal-prefix-without-digits (TS1351 against TS1125, TS1177, TS1178)", x => x.tsc[2]?.[0] === 1351],
    ["export-type-without-name", x => /export\s+type\s*(=|default\b)/.test(x.src)],
    ["invalid-character-span (TS1127 length 0 against 1)", x => x.tsc[2]?.[0] === 1127 && x.go[2]?.[0] === 1127],
    ["jsdoc-question (a `?` that is a whole type, or `?` before a function type)", x => /\?/.test(x.src)],
  ];
  const causeOf = x => (CAUSES.find(c => c[1](x)) ?? ["other"])[0];
  const byCause = {};
  for (const [kind, list] of [["verdict", goDiff.verdict], ["first", goDiff.first]]) {
    for (const x of list) {
      const c = (byCause[causeOf(x)] ??= { verdict: 0, first: 0, dirs: {}, ex: [], rows: new Set() });
      c[kind]++;
      c.rows.add(x.i);
      if (kind === "verdict") inc(c.dirs, x.tsc[0] === 0 ? "tsc accepts, typescript-go rejects" : "typescript-go accepts, tsc rejects");
      else inc(c.dirs, `both reject: TS${x.tsc[2][0]} -> TS${x.go[2][0]}`);
      c.ex.push(x);
    }
  }
  const C = ["Disagreements of tsc 6.0.2 and typescript-go by cause (rows x dialects; verdict = one accepts and one rejects, first = both reject with another first diagnostic).", ""];
  for (const [name, c] of Object.entries(byCause).sort((a, b) => b[1].verdict + b[1].first - a[1].verdict - a[1].first)) {
    C.push(`${name}: verdict ${c.verdict}, first ${c.first}, distinct sources ${c.rows.size}`);
    for (const [d, n] of Object.entries(c.dirs).sort((a, b) => b[1] - a[1]).slice(0, 8)) C.push(`      ${String(n).padStart(5)}  ${d}`);
    const seen = new Set();
    const limit = name === "other" ? 1000 : 6;
    for (const x of c.ex.sort((a, b) => a.src.length - b.src.length)) {
      if (seen.has(x.src) || seen.size >= limit) continue;
      seen.add(x.src);
      C.push(`      ${x.d} ${short(x.src, 100)}  tsc ${x.tsc[0] === 0 ? "accepts" : JSON.stringify(x.tsc[2]) + " " + x.tsc[1]}  |  go ${x.go[0] === 0 ? "accepts" : JSON.stringify(x.go[2]) + " " + x.go[1]}`);
    }
  }
  w("tsc-vs-tsgo.causes.txt", C.join("\n"));
  const V = ["i\tdialect\ttsc count\ttsc first\ttsc message\tgo count\tgo first\tgo message\torigins\tsource"];
  for (const x of goDiff.verdict)
    V.push([x.i, x.d, x.tsc[0], (x.tsc[2] ?? []).join(","), tsv(x.tsc[1]), x.go[0], (x.go[2] ?? []).join(","), tsv(x.go[1]), x.o.slice(0, 3).join(" "), tsv(x.src)].join("\t"));
  w("tsc-vs-tsgo.verdict.tsv", V.join("\n"));
  const F = ["i\tdialect\ttsc count\ttsc first\ttsc message\tgo count\tgo first\tgo message\tsource"];
  for (const x of goDiff.first) F.push([x.i, x.d, x.tsc[0], x.tsc[2].join(","), tsv(x.tsc[1]), x.go[0], x.go[2].join(","), tsv(x.go[1]), tsv(x.src)].join("\t"));
  wz("tsc-vs-tsgo.first.tsv.gz", F.join("\n") + "\n");
  const LT = ["i\tdialect\ttsc count and [code,start,length] from the second on\tgo count and the same\tsource"];
  for (const x of goDiff.later) LT.push([x.i, x.d, x.tsc[0] + " " + JSON.stringify(x.tsc.slice(3)), x.go[0] + " " + JSON.stringify(x.go.slice(3)), tsv(x.src)].join("\t"));
  w("tsc-vs-tsgo.later.tsv", LT.join("\n"));
  const P = ["i\tdialect\tgo\tsource"];
  for (const x of goDiff.panic) P.push([x.i, x.d, tsv(JSON.stringify(x.go)), tsv(x.src.slice(0, 300))].join("\t"));
  w("tsc-vs-tsgo.panic.tsv", P.join("\n"));
}

// ───────────── pins ─────────────
{
  const flip = ["pin (test file:line loader method expectation)\tclass R (A1 split)\tclass G\tclass V\tchecker codes\ttsc emit parses as js\tsource"];
  const keep = ["pin\ttsc first code\tstart\tlength\ttsc message\ttypescript-go first\tsource"];
  const odd = ["pin\tstage 1 verdict of the same loader\tsource"];
  const S = { pins: 0, expectError: 0, expectOk: 0, flip: 0, flipByN: {}, flipJs: 0, keep: 0, errorBoth: 0, okBoth: 0, odd: 0, bundleFiles: 0, bundleKeep: 0, bundleA: 0 };
  const aByI = new Map(A.map(e => [e.row.i, e]));
  for (const row of corpus) {
    if (!row.pin) continue;
    const b = bun.get(row.i);
    const t = tsc.get(row.i).t;
    const g = go.get(row.i);
    for (const pin of row.pin) {
      S.pins++;
      const mFile = / file (\S+)/.exec(pin);
      if (mFile) {
        S.bundleFiles++;
        const d = /\.tsx$/.test(mFile[1]) ? "tsx" : "ts";
        const bb = b.crash ? "CRASH" : b.b[d === "tsx" ? 1 : 0];
        if (bb === 1 && t[d][0] !== 0) {
          S.bundleKeep++;
          keep.push([pin, t[d][2][0], t[d][2][1], t[d][2][2], tsv(t[d][1]), g?.[d]?.[2]?.join(",") ?? "", tsv(row.src)].join("\t"));
        } else if (bb !== 1 && t[d][0] === 0) {
          S.bundleA++;
          const x = aByI.get(row.i)?.views[d];
          flip.push([pin + "  (bun rejects: " + (bb === "CRASH" ? "CRASH" : bb[0]) + ")", x?.sub ?? "", x?.G ?? "", x?.V ?? "", x?.codes.join(",") ?? "", x?.js === 1 ? "yes" : "no", tsv(row.src)].join("\t"));
        }
        continue;
      }
      const m = /^(\S+) (ts|tsx) (\S+) (ok|E:.*)$/s.exec(pin);
      if (!m) continue;
      const d = m[2];
      const expectsError = m[4] !== "ok";
      const tscOk = t[d][0] === 0;
      const bb = b.crash ? "CRASH" : b.b[d === "tsx" ? 1 : 0];
      if ((bb === 1) === expectsError && m[3] === "transformSync") {
        S.odd++;
        odd.push([pin, bb === 1 ? "accepts" : tsv(bb[0]), tsv(row.src)].join("\t"));
      }
      if (expectsError) {
        S.expectError++;
        if (tscOk) {
          S.flip++;
          const x = aByI.get(row.i)?.views[d];
          inc(S.flipByN, x?.sub ?? "not in set A of stage 1");
          if (x?.js === 1) S.flipJs++;
          flip.push([pin, x?.sub ?? "", x?.G ?? "", x?.V ?? "", x?.codes.join(",") ?? "", x?.js === 1 ? "yes" : x?.js ? "no: " + tsv(x.js[0]) : "", tsv(row.src)].join("\t"));
        } else S.errorBoth++;
      } else {
        S.expectOk++;
        if (!tscOk) {
          S.keep++;
          keep.push([pin, t[d][2][0], t[d][2][1], t[d][2][2], tsv(t[d][1]), g?.[d]?.[2]?.join(",") ?? "", tsv(row.src)].join("\t"));
        } else S.okBoth++;
      }
    }
  }
  w("pins.flip.tsv", flip.join("\n"));
  w("pins.keep.tsv", keep.join("\n"));
  w("pins.odd.tsv", odd.join("\n"));
  w(
    "pins.summary.txt",
    [
      "Pins are calls of the existing tests with a TypeScript loader, recorded with the base build.",
      `pins (call sites x distinct input): ${S.pins - S.bundleFiles}; files of itBundled cases: ${S.bundleFiles}`,
      `the test expects an error: ${S.expectError}`,
      `   tsc parses the input without a diagnostic (a set A fix flips the expectation): ${S.flip}   -> pins.flip.tsv`,
      `      by class of rule R (A1 split): ${JSON.stringify(S.flipByN)}; tsc's emit parses as js for ${S.flipJs}`,
      `   tsc rejects as well: ${S.errorBoth}`,
      `the test expects the input to be accepted: ${S.expectOk}`,
      `   the parser of tsc rejects it (a parse without lint must keep accepting it): ${S.keep}   -> pins.keep.tsv`,
      `   tsc accepts as well: ${S.okBoth}`,
      `files of itBundled cases that the bun side accepts and tsc rejects: ${S.bundleKeep}; that the bun side rejects and tsc parses: ${S.bundleA}`,
      `recorded outcome and the stage 1 verdict of the same loader disagree (options of the test's transpiler): ${S.odd}   -> pins.odd.tsv`,
    ].join("\n"),
  );
}

// ───────────── first codes of rejected inputs ─────────────
{
  wz("codes.first.tsv.gz", ["i\tdialect\ttsc count\ttsc code\tstart\tlength\ttypescript-go first (code,start,length)\tbun\tbun line:column\tsource", ...firstCodes].join("\n") + "\n");
  const hist = { RR: {}, B: {} };
  for (const l of firstCodes) {
    const f = l.split("\t");
    if (f[1] !== "ts") continue;
    inc(hist[f[7] === "ok" ? "B" : "RR"], f[3]);
  }
  const L = [];
  L.push("First parse diagnostic of tsc for the inputs it rejects as input.ts.");
  L.push(`both reject: ${posAgree.rr} rows; the first error of the bun side is at tsc's start (same line and column): ${posAgree.same}; same line, other column: ${posAgree.sameLine}`);
  L.push("");
  L.push("code\trows where both reject\trows where only tsc rejects (set B)");
  const all = new Set([...Object.keys(hist.RR), ...Object.keys(hist.B)]);
  for (const c of [...all].sort((a, b) => (hist.RR[b] ?? 0) + (hist.B[b] ?? 0) - (hist.RR[a] ?? 0) - (hist.B[a] ?? 0))) L.push(`TS${c}\t${hist.RR[c] ?? 0}\t${hist.B[c] ?? 0}`);
  L.push("");
  L.push("The first message of the bun side against the first code of tsc, rows where both reject (view ts):");
  for (const [msg, codes] of Object.entries(bunMsgToCode).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))) {
    const total = Object.values(codes).reduce((x, y) => x + y, 0);
    L.push(`${String(total).padStart(7)}  ${msg}`);
    L.push(`           ${Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => `TS${c}x${n}`).join(" ")}${Object.keys(codes).length > 10 ? ` (+${Object.keys(codes).length - 10} more codes)` : ""}`);
  }
  w("codes.summary.txt", L.join("\n"));
}
console.log("written to " + outDir);
// Files: table.jsonl.gz (every row: b, t, g, v; join with the corpus on i), totals.txt,
// setA.classes.txt, setA.rows.tsv.gz, setA.codes.<view>.tsv, setA.causes.<view>.txt, setA.worklist.<view>.tsv,
// setB.causes.<view>.txt, setB.rows.tsv.gz,
// tsc-vs-tsgo.summary.txt, tsc-vs-tsgo.causes.txt, tsc-vs-tsgo.verdict.tsv, tsc-vs-tsgo.later.tsv, tsc-vs-tsgo.first.tsv.gz, tsc-vs-tsgo.panic.tsv,
// pins.summary.txt, pins.flip.tsv, pins.keep.tsv, pins.odd.tsv, codes.first.tsv.gz, codes.summary.txt
