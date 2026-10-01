// Phase 3 of the classifier: the tables.
//
//   <base build of bun> report.mjs <data dir> <out dir> <pinned.jsonl>
//
// Reads the four sides (data dir), classes.jsonl.gz, a-check.jsonl, a-emit.bun.jsonl.gz, tsc-vs-tsgo.tsv.gz
// (out dir) and the pinned expectations. Writes into the out dir:
//   setA.tsv.gz            every source that tsc parses without a diagnostic and the base build rejects
//   setA.by-message.tsv    set A by cause: the first message of Bun (names and literals replaced)
//   setA.by-family.tsv     set A by the production family of the origin
//   setA.by-code.tsv       set A by checker code (a row counts under each of its codes)
//   setB.tsv.gz            every source that the base build accepts and tsc rejects
//   setB.by-code.tsv       set B by cause: the first parse diagnostic of tsc
//   setB.by-family.tsv     set B by the production family of the origin
//   flips.tsv              every pinned rejection of an existing test whose source is in set A
//   pinned-classes.tsv     every pinned expectation with the class of its source
//   tsc-vs-tsgo.by-cause.tsv   every disagreement of tsc 6.0.2 and typescript-go, by root cause
//   report.summary.txt
// Classes of a set A row, two definitions:
//   D1 (the two tsc oracle probes): A2 when the checker reports a code below 2000 or in 8xxx, 17xxx, 18xxx, else A1
//   D2 (every checker diagnostic minus the noise of a one-file program without a library):
//      A1 no rule code, A2 a rule code of the ranges of D1, A3 rule codes only outside those ranges
//      A1 is split: A1r an unresolved name is a reserved word (no program can declare it), A1j the JavaScript
//      that tsc prints is rejected by the js loader of Bun, A1v the rest (valid TypeScript by every test here)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { isGrammarCode, readBunSide, readJsonl, readLines, readParseSide, tsv } from "./lib.mjs";

const [dataDir, outDir, pinnedPath] = process.argv.slice(2);
if (!dataDir || !outDir || !pinnedPath) {
  console.error("usage: <base build of bun> report.mjs <data dir> <out dir> <pinned.jsonl>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Codes that depend on the names, types and library of the probe program, or on noImplicitAny. Not rules of syntax.
export const NOISE = new Set([
  1169, 1170, 1238, 1240, 1241, 1329, 2304, 2305, 2306, 2307, 2314, 2315, 2318, 2322, 2339, 2344, 2345, 2347, 2349, 2351,
  2352, 2355, 2362, 2363, 2365, 2367, 2370, 2377, 2378, 2405, 2411, 2413, 2448, 2454, 2456, 2461, 2464, 2469, 2502, 2503,
  2531, 2532, 2533, 2538, 2552, 2554, 2558, 2564, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593, 2635, 2677, 2683,
  2686, 2693, 2694, 2695, 2697, 2711, 2739, 2740, 2741, 2749, 2769, 2792, 2833, 2867, 2868, 2872, 2873, 2874, 2875, 2879,
  2882, 6142, 7005, 7006, 7008, 7010, 7011, 7014, 7015, 7016, 7017, 7018, 7019, 7022, 7023, 7024, 7026, 7031, 7032, 7033,
  7034, 7041, 7053, 7057, 17004, 18046, 18047, 18048, 18049, 18050,
]);

const corpus = readJsonl(join(dataDir, "corpus.jsonl.gz"));
const byId = new Map(corpus.map(r => [r.id, r]));
const base = readBunSide(join(dataDir, "bun.base.jsonl.gz"));
const tsc = readParseSide(join(dataDir, "tsc.jsonl.gz"));
const tsgo = readParseSide(join(dataDir, "tsgo.jsonl.gz"));
const classes = new Map(readJsonl(join(outDir, "classes.jsonl.gz")).map(r => [r.id, r]));
const checks = new Map(readJsonl(join(outDir, "a-check.jsonl")).map(r => [r.id, r]));
const emitBun = readBunSide(join(outDir, "a-emit.bun.jsonl.gz"));
const pinned = readJsonl(pinnedPath);

const summary = [];
const say = s => {
  summary.push(s);
  console.log(s);
};

const WORDS = new Set(
  (
    "abstract accessor any as asserts assert async await bigint boolean break case catch class const constructor continue debugger declare default defer delete do else enum export extends false finally for from function get global if implements import in infer instanceof interface intrinsic is keyof let module namespace never new null number object of out override package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown using var void while with yield"
  ).split(" "),
);
const normToken = t => {
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return WORDS.has(t) ? t : "<name>";
  if (/^[0-9]/.test(t)) return "<number>";
  if (/^['"`]/.test(t) && t.length > 1) return "<string>";
  return t;
};
const normMessage = m =>
  m
    .replace(/but found "((?:[^"\\]|\\.)*)"/g, (_, t) => `but found "${normToken(t)}"`)
    .replace(/^Unexpected "((?:[^"\\]|\\.)*)"$/, (_, t) => `Unexpected "${normToken(t)}"`)
    .replace(/^Unexpected ([A-Za-z_$][\w$]*)$/, (_, t) => `Unexpected ${normToken(t)}`)
    .replace(/^"((?:[^"\\]|\\.)*)" has already been declared$/, '"<name>" has already been declared')
    .replace(/^"((?:[^"\\]|\\.)*)" is a reserved word and cannot be used/, (_, t) => `"${normToken(t)}" is a reserved word and cannot be used`);
const familyOf = tag => {
  let t = tag.replace(/[@~].*$/, "");
  if (t.startsWith("td/")) t = t.replace(/\.\d+$/, "").replace(/^(td\/\d+\/[^.]+)\..*$/, "$1");
  else if (t.startsWith("test/")) t = t.replace(/:\d+$/, "");
  else if (t.startsWith("lex/") || t.startsWith("sc/")) t = t.split("/").slice(0, 2).join("/");
  return t;
};
const top = (map, n) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => `${k} (${c})`)
    .join("; ");
const bump = (map, k, by = 1) => map.set(k, (map.get(k) ?? 0) + by);

const pinnedBySrc = new Map();
for (const p of pinned) {
  if (!pinnedBySrc.has(p.src)) pinnedBySrc.set(p.src, []);
  pinnedBySrc.get(p.src).push(p);
}

// ───────────────────────────── set A ─────────────────────────────
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split(" "),
);
const aRows = [];
for (const chk of checks.values()) {
  const rec = byId.get(chk.id);
  const d = chk.dialect;
  const bun = base.out.get(chk.id)[d === "tsx" ? "tsx" : "ts"];
  const rule = chk.codes.filter(c => !NOISE.has(c[0]));
  const noise = chk.codes.filter(c => NOISE.has(c[0])).map(c => c[0]);
  const d1 = chk.codes.some(c => isGrammarCode(c[0])) ? "A2" : "A1";
  const d2 = rule.length === 0 ? "A1" : rule.some(c => isGrammarCode(c[0])) ? "A2" : "A3";
  let js;
  if (chk.emitThrew) js = "emit threw: " + chk.emitThrew;
  else {
    const e = emitBun.out.get(chk.id);
    const v = e?.crash !== undefined ? null : e?.[d === "tsx" ? "jsx" : "js"];
    js = !v ? "crash" : v[0] === "o" ? "ok" : "rejected: " + v[1][0][0];
  }
  const g = tsgo.out.get(chk.id)[d];
  const pins = (pinnedBySrc.get(rec.src) ?? []).filter(p => p.pin === "reject");
  const reserved = (chk.names ?? []).filter(n => RESERVED.has(n));
  const d2x = d2 !== "A1" ? d2 : reserved.length > 0 ? "A1r" : js !== "ok" ? "A1j" : "A1v";
  aRows.push({
    id: chk.id,
    dialect: d,
    d1,
    d2,
    d2x,
    reserved,
    js,
    tsgo: g[0] === 0 ? "parses" : `TS${g[1][0][0]}`,
    message: bun[1][0][0],
    offset: bun[1][0][3],
    rule,
    noise,
    decoRule: chk.decoCodes ? chk.decoCodes.filter(c => !NOISE.has(c[0])).map(c => c[0]) : null,
    pins,
    family: familyOf(rec.o[0]),
    rec,
  });
}
{
  const lines = ["id\tdialect\tD1\tD2\tD2 detail\ttsc emit through Bun's js loader\ttypescript-go\tBun message\toffset\trule codes\tnoise codes\trule codes with experimentalDecorators when they differ\tpinned by\torigin family\tsets\tsource"];
  for (const r of aRows) {
    lines.push(
      [r.id, r.dialect, r.d1, r.d2, r.d2x, r.js, r.tsgo, tsv(r.message), r.offset, r.rule.map(c => c[0]).join(","), r.noise.join(","), r.decoRule ? r.decoRule.join(",") || "none" : "", r.pins.map(p => p.at).join(" "), r.family, r.rec.sets.join(","), tsv(r.rec.src)].join("\t"),
    );
  }
  writeFileSync(join(outDir, "setA.tsv.gz"), gzipSync(lines.join("\n") + "\n"));
}
const cnt = (rows, f) => rows.filter(f).length;
const aLine = rows =>
  `${rows.length}\t${cnt(rows, r => r.d2x === "A1v")}\t${cnt(rows, r => r.d2x === "A1r")}\t${cnt(rows, r => r.d2x === "A1j")}\t${cnt(rows, r => r.d2 === "A2")}\t${cnt(rows, r => r.d2 === "A3")}\t${cnt(rows, r => r.d1 === "A1")}\t${cnt(rows, r => r.d1 === "A2")}\t${cnt(rows, r => r.js !== "ok")}\t${cnt(rows, r => r.tsgo !== "parses")}\t${cnt(rows, r => r.pins.length > 0)}`;
const A_HEAD = "rows\tD2 A1v\tD2 A1r\tD2 A1j\tD2 A2\tD2 A3\tD1 A1\tD1 A2\ttsc emit rejected by Bun's js loader\ttypescript-go rejects\tpinned";
function groupTable(rows, keyOf, file, head, extra) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const lines = [head];
  for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) lines.push(extra(k, list));
  writeFileSync(join(outDir, file), lines.join("\n") + "\n");
  return groups;
}
const shortest = list => list.reduce((a, b) => (b.rec.src.length < a.rec.src.length ? b : a)).rec.src;
const byMessage = groupTable(
  aRows,
  r => normMessage(r.message),
  "setA.by-message.tsv",
  `Bun message\t${A_HEAD}\tfamilies\tshortest example`,
  (k, list) => {
    const fam = new Map();
    for (const r of list) bump(fam, r.family);
    return `${tsv(k)}\t${aLine(list)}\t${top(fam, 6)}\t${tsv(shortest(list))}`;
  },
);
const byFamily = groupTable(
  aRows,
  r => r.family,
  "setA.by-family.tsv",
  `origin family\t${A_HEAD}\tBun messages\trule codes\tshortest example`,
  (k, list) => {
    const msg = new Map();
    const codes = new Map();
    for (const r of list) {
      bump(msg, normMessage(r.message));
      for (const c of r.rule) bump(codes, `TS${c[0]}`);
    }
    return `${k}\t${aLine(list)}\t${top(msg, 4)}\t${top(codes, 6)}\t${tsv(shortest(list))}`;
  },
);
{
  const codes = new Map();
  for (const r of aRows) {
    for (const c of r.rule) {
      if (!codes.has(c[0])) codes.set(c[0], { text: c[1], rows: [] });
      codes.get(c[0]).rows.push(r);
    }
  }
  const lines = [`code\trange\tmessage of the first report\t${A_HEAD}\trows where it is the only rule code\tshortest example`];
  for (const [code, v] of [...codes].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
    lines.push(`TS${code}\t${isGrammarCode(code) ? "grammar range" : "outside"}\t${tsv(v.text)}\t${aLine(v.rows)}\t${cnt(v.rows, r => r.rule.length === 1)}\t${tsv(shortest(v.rows))}`);
  }
  writeFileSync(join(outDir, "setA.by-code.tsv"), lines.join("\n") + "\n");
}
say(`set A (tsc 6.0.2 parses without a diagnostic, the base build rejects): ${aRows.length} sources`);
say(`  definition D1 (grammar ranges only):       A1=${cnt(aRows, r => r.d1 === "A1")}  A2=${cnt(aRows, r => r.d1 === "A2")}`);
say(`  definition D2 (every code minus noise):    A1=${cnt(aRows, r => r.d2 === "A1")}  A2=${cnt(aRows, r => r.d2 === "A2")}  A3=${cnt(aRows, r => r.d2 === "A3")}`);
say(`  rows whose class differs between D1 and D2: ${cnt(aRows, r => r.d1 !== r.d2)} (D1 A1 -> D2 A3: ${cnt(aRows, r => r.d1 === "A1" && r.d2 === "A3")}, D1 A2 -> D2 A1: ${cnt(aRows, r => r.d1 === "A2" && r.d2 === "A1")})`);
say(`  the checker reports nothing at all: ${cnt(aRows, r => r.rule.length === 0 && r.noise.length === 0)}`);
say(`  D2 A1 split: A1v=${cnt(aRows, r => r.d2x === "A1v")} (valid by every test here)  A1r=${cnt(aRows, r => r.d2x === "A1r")} (an unresolved name is a reserved word)  A1j=${cnt(aRows, r => r.d2x === "A1j")} (tsc emit rejected by the js loader of Bun)`);
for (const cls of ["A1v", "A1r", "A1j", "A2", "A3"]) {
  const list = aRows.filter(r => r.d2x === cls);
  say(`  D2 ${cls}: ${list.length} rows; tsc emit rejected by Bun's js loader ${cnt(list, r => r.js !== "ok")}; typescript-go rejects ${cnt(list, r => r.tsgo !== "parses")}; pinned by an existing test ${cnt(list, r => r.pins.length > 0)}; distinct Bun messages ${new Set(list.map(r => normMessage(r.message))).size}`);
}
say(`  distinct Bun messages ${byMessage.size}, origin families ${byFamily.size}`);
say(`  per origin set (D2 A1v / A1r / A1j / A2 / A3):`);
for (const s of ["bu", "td", "otg", "res", "gd", "lex", "sc", "test"]) {
  const list = aRows.filter(r => r.rec.sets.includes(s));
  say(`    ${s.padEnd(5)} ${String(list.length).padStart(6)}   ${cnt(list, r => r.d2x === "A1v")} / ${cnt(list, r => r.d2x === "A1r")} / ${cnt(list, r => r.d2x === "A1j")} / ${cnt(list, r => r.d2 === "A2")} / ${cnt(list, r => r.d2 === "A3")}`);
}

// ───────────────────────────── set B ─────────────────────────────
const bRows = [];
for (const rec of corpus) {
  const cls = classes.get(rec.id);
  const d = rec.tsxOnly ? "tsx" : "ts";
  if (cls[d] !== "B") continue;
  const t = tsc.out.get(rec.id)[d];
  const g = tsgo.out.get(rec.id)[d];
  const pins = (pinnedBySrc.get(rec.src) ?? []).filter(p => p.pin === "accept");
  bRows.push({ id: rec.id, dialect: d, first: t[1][0], n: t[0], tsgo: g, pins, family: familyOf(rec.o[0]), rec });
}
{
  const lines = ["id\tdialect\ttsc first code\tstart\tlength\tmessage\ttsc diagnostics\ttypescript-go first code\tstart\tlength\tpinned acceptance\torigin family\tsets\tsource"];
  for (const r of bRows) {
    const g = r.tsgo[0] === 0 ? ["parses", "", ""] : [`TS${r.tsgo[1][0][0]}`, r.tsgo[1][0][1], r.tsgo[1][0][2]];
    lines.push([r.id, r.dialect, `TS${r.first[0]}`, r.first[1], r.first[2], tsv(r.first[3]), r.n, ...g, r.pins.map(p => p.at).join(" "), r.family, r.rec.sets.join(","), tsv(r.rec.src)].join("\t"));
  }
  writeFileSync(join(outDir, "setB.tsv.gz"), gzipSync(lines.join("\n") + "\n"));
}
const bLine = rows =>
  `${rows.length}\t${cnt(rows, r => r.tsgo[0] !== 0 && r.tsgo[1][0][0] === r.first[0] && r.tsgo[1][0][1] === r.first[1] && r.tsgo[1][0][2] === r.first[2])}\t${cnt(rows, r => r.tsgo[0] !== 0 && (r.tsgo[1][0][0] !== r.first[0] || r.tsgo[1][0][1] !== r.first[1] || r.tsgo[1][0][2] !== r.first[2]))}\t${cnt(rows, r => r.tsgo[0] === 0)}\t${cnt(rows, r => r.pins.length > 0)}`;
const B_HEAD = "rows\ttypescript-go: same first code and span\ttypescript-go: other first diagnostic\ttypescript-go parses\tpinned acceptance";
const bByCode = groupTable(
  bRows,
  r => `TS${r.first[0]}\t${r.first[3]}`,
  "setB.by-code.tsv",
  `tsc first code\tmessage\t${B_HEAD}\tfamilies\tshortest example`,
  (k, list) => {
    const fam = new Map();
    for (const r of list) bump(fam, r.family);
    return `${k.split("\t")[0]}\t${tsv(k.split("\t")[1])}\t${bLine(list)}\t${top(fam, 6)}\t${tsv(shortest(list))}`;
  },
);
groupTable(
  bRows,
  r => r.family,
  "setB.by-family.tsv",
  `origin family\t${B_HEAD}\ttsc first codes\tshortest example`,
  (k, list) => {
    const codes = new Map();
    for (const r of list) bump(codes, `TS${r.first[0]} ${r.first[3]}`);
    return `${k}\t${bLine(list)}\t${top(codes, 5)}\t${tsv(shortest(list))}`;
  },
);
say("");
say(`set B (the base build accepts, tsc 6.0.2 reports a parse diagnostic): ${bRows.length} sources, ${bByCode.size} distinct first diagnostics (code and message)`);
{
  const codeOnly = new Map();
  for (const r of bRows) bump(codeOnly, `TS${r.first[0]}`);
  say(`  first codes: ${top(codeOnly, 14)}`);
  say(`  typescript-go: same first code and span ${cnt(bRows, r => r.tsgo[0] !== 0 && r.tsgo[1][0][0] === r.first[0] && r.tsgo[1][0][1] === r.first[1] && r.tsgo[1][0][2] === r.first[2])}, other first diagnostic ${cnt(bRows, r => r.tsgo[0] !== 0 && (r.tsgo[1][0][0] !== r.first[0] || r.tsgo[1][0][1] !== r.first[1] || r.tsgo[1][0][2] !== r.first[2]))}, parses ${cnt(bRows, r => r.tsgo[0] === 0)}`);
  say(`  pinned as accepted by an existing test: ${cnt(bRows, r => r.pins.length > 0)} sources`);
}

// ───────────────────────────── pinned expectations ─────────────────────────────
{
  const bySrcId = new Map(corpus.map(r => [r.src, r.id]));
  const aById = new Map(aRows.map(r => [r.id, r]));
  const bById = new Map(bRows.map(r => [r.id, r]));
  const lines = ["pin\tclass\tat\tloader\tmethod\tpinned messages\ttsc\ttypescript-go\tsource"];
  const flips = ["at\tloader\tmethod\tpinned messages\tD1\tD2\trule codes\ttsc emit through Bun's js loader\ttypescript-go\tsource"];
  const counts = new Map();
  const flipCounts = { total: 0, A1: 0, A2: 0, A3: 0, d1A1: 0, d1A2: 0, jsBad: 0, sources: new Set(), byMessage: new Map(), byFile: new Map() };
  let unknown = 0;
  for (const p of pinned) {
    const id = bySrcId.get(p.src);
    let cls = "not in the corpus";
    let tscText = "";
    let goText = "";
    if (id !== undefined) {
      const d = p.loader === "tsx" ? "tsx" : "ts";
      cls = classes.get(id)[d];
      const t = tsc.out.get(id)[d];
      const g = tsgo.out.get(id)[d];
      tscText = t[0] === 0 ? "parses" : `TS${t[1][0][0]} ${t[1][0][3]}`;
      goText = g[0] === 0 ? "parses" : `TS${g[1][0][0]} ${g[1][0][3]}`;
    } else unknown++;
    bump(counts, `${p.pin} ${cls}`);
    lines.push([p.pin, cls, p.at, p.loader, p.method, tsv(p.messages.join(" | ")), tsv(tscText), tsv(goText), tsv(p.src)].join("\t"));
    if (p.pin === "reject" && cls === "A") {
      const a = aById.get(id);
      if (!a) continue;
      flipCounts.total++;
      flipCounts[a.d2x] = (flipCounts[a.d2x] ?? 0) + 1;
      flipCounts[a.d1 === "A1" ? "d1A1" : "d1A2"]++;
      if (a.js !== "ok") flipCounts.jsBad++;
      flipCounts.sources.add(id);
      bump(flipCounts.byMessage, normMessage(p.messages[0] ?? ""));
      bump(flipCounts.byFile, p.at.replace(/:\d+$/, ""));
      flips.push([p.at, p.loader, p.method, tsv(p.messages.join(" | ")), a.d1, a.d2x, a.rule.map(c => `TS${c[0]}`).join(","), a.js, a.tsgo, tsv(p.src)].join("\t"));
    }
    void bById;
  }
  writeFileSync(join(outDir, "pinned-classes.tsv"), lines.join("\n") + "\n");
  writeFileSync(join(outDir, "flips.tsv"), flips.join("\n") + "\n");
  say("");
  say(`pinned expectations of the existing tests: ${pinned.length} rows (${unknown} with a source that is not in the corpus)`);
  for (const [k, n] of [...counts].sort()) say(`  ${String(n).padStart(5)}  ${k}`);
  say(`  a set A fix flips ${flipCounts.total} pinned rejections (${flipCounts.sources.size} distinct sources): D2 A1v=${flipCounts.A1v ?? 0} A1r=${flipCounts.A1r ?? 0} A1j=${flipCounts.A1j ?? 0} A2=${flipCounts.A2} A3=${flipCounts.A3}; D1 A1=${flipCounts.d1A1} A2=${flipCounts.d1A2}; tsc emit rejected by Bun's js loader ${flipCounts.jsBad}`);
  say(`  by test file: ${top(flipCounts.byFile, 8)}`);
  say(`  by pinned message: ${top(flipCounts.byMessage, 12)}`);
}

// ───────────────────────────── tsc against typescript-go, by root cause ─────────────────────────────
{
  const rows = readLines(join(outDir, "tsc-vs-tsgo.tsv.gz"))
    .slice(1)
    .map(l => l.split("\t"));
  const MOD = /\b(public|private|protected|readonly|override|static|abstract|declare|accessor|async|export|const|in|out|default)\s+\.\.\./;
  const causeOf = (kind, src, a, g) => {
    if (/\bassert\b/.test(src) && /TS2880/.test(g)) return "import assertion (`assert { }`): typescript-go reports TS2880 in the parser, tsc 6.0.2 leaves it to the checker";
    if (/typeof[^;=]*#/.test(src)) return "private name in a type query (`typeof a.#b`): typescript-go parses it (parseEntityName with allowPrivateName), tsc 6.0.2 reports TS1003";
    if (/\bfunction\b\s*[.<]/.test(src) && !/\bfunction\s*\(/.test(src)) return "the word `function` as a type name followed by `.` or `<`: typescript-go reads a type reference, tsc 6.0.2 rejects";
    if (/\bfunction\b/.test(src)) return "JSDoc function type `function(...)` at a type position: a type for tsc 6.0.2 (checker TS8020), no production in typescript-go";
    if (MOD.test(src)) return "modifier before a rest parameter in a function type (`(public ...a) => T`): typescript-go's skipParameterStart skips `...` behind modifiers, tsc 6.0.2 does not";
    if (/\/\/\/\s*<reference/.test(src)) return "triple-slash reference directive: malformed directive (TS1084 only in typescript-go's parser) or position of TS1453";
    if (/\b(type|interface)\s+await\b/.test(src)) return "`await` as the name of an exported type alias or interface";
    if (/export\s+type\s*(=|default\b)/.test(src)) return "`export type =` and `export type default`: other first code";
    if (/\b(as|satisfies)\b/.test(src) && /^0:/.test(a) && /TS1005/.test(g)) return "`as` / `satisfies` followed by an operator that binds tighter than the one before it: typescript-go stops (TypeScript issue 63527), tsc 6.0.2 continues";
    if (/TS1127/.test(a) && /TS1127/.test(g)) return "TS1127 Invalid character: length 0 in tsc 6.0.2, length 1 in typescript-go";
    if (/TS1351/.test(a) && /TS(1125|1177|1178)/.test(g)) return "numeric literal prefix without digits (`0x`, `0b`, `0o`): TS1351 in tsc 6.0.2, TS1125 / TS1177 / TS1178 in typescript-go";
    if (!/^[\x00-\x7f]*$/.test(src)) return "source is not ASCII: tsc counts UTF-16 code units, typescript-go bytes";
    if (/\?/.test(src)) return "`?` at a type position (JSDoc unknown and nullable types): tsc 6.0.2 reads a lone `?` as a type, typescript-go requires a type behind it";
    return "other";
  };
  const groups = new Map();
  for (const [kind, d, id, srcJson, a, g, origin] of rows) {
    const src = JSON.parse(srcJson);
    const cause = causeOf(kind, src, a, g);
    if (!groups.has(cause)) groups.set(cause, { ts: 0, tsx: 0, dts: 0, verdictA: 0, verdictG: 0, other: 0, sources: new Set(), ex: [] });
    const v = groups.get(cause);
    v[d]++;
    if (d === "ts" || (d === "tsx" && !v.sources.has(id))) {
      if (kind.startsWith("VERDICT  tsc parses")) v.verdictA++;
      else if (kind.startsWith("VERDICT  tsc reports")) v.verdictG++;
      else v.other++;
    }
    v.sources.add(id);
    if (d !== "dts") v.ex.push([src, a, g, kind]);
  }
  const lines = ["root cause\tsources\tpairs as ts\tas tsx\tas d.ts\tverdict: tsc parses, typescript-go rejects\tverdict: tsc rejects, typescript-go parses\tboth reject with other diagnostics\texamples (source || tsc || typescript-go)"];
  say("");
  say(`tsc 6.0.2 against typescript-go 89d5d5b by root cause (sources; verdict tsc parses and typescript-go rejects / tsc rejects and typescript-go parses / both reject differently):`);
  for (const [cause, v] of [...groups].sort((a, b) => b[1].sources.size - a[1].sources.size)) {
    v.ex.sort((x, y) => x[0].length - y[0].length);
    const seen = new Set();
    const ex = [];
    for (const e of v.ex) {
      if (seen.has(e[0])) continue;
      seen.add(e[0]);
      ex.push(`${JSON.stringify(e[0])} || ${e[1]} || ${e[2]}`);
      if (ex.length >= (cause === "other" ? 40 : 4)) break;
    }
    lines.push(`${cause}\t${v.sources.size}\t${v.ts}\t${v.tsx}\t${v.dts}\t${v.verdictA}\t${v.verdictG}\t${v.other}\t${ex.join("  ;;  ")}`);
    say(`  ${String(v.sources.size).padStart(4)}  ${v.verdictA} / ${v.verdictG} / ${v.other}  ${cause}`);
  }
  writeFileSync(join(outDir, "tsc-vs-tsgo.by-cause.tsv"), lines.join("\n") + "\n");
}
writeFileSync(join(outDir, "report.summary.txt"), summary.join("\n") + "\n");
