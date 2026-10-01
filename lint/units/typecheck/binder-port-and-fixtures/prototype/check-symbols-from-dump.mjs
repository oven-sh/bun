// Checks the declaration lines of a .symbols baseline of the reference against a bind dump, with no checker.
// usage: bun check-symbols-from-dump.mjs <SELECTION.tsv> <units dir> <dumps dir>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseSymbolsBaseline } from "./symbols-baseline.mjs";
const require = createRequire(process.env.TS_ROOT ?? "/workspace/wt/typecheck/node_modules/");
const ts = require("typescript");
const BASE = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const REPARSED = 1 << 3, IN_WITH_STATEMENT = 1 << 24;

export function parseDump(text) {
  const nodes = [], symbols = new Map();
  let section = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("== ")) { section = line.slice(3); continue; }
    if (section === "nodes") {
      const m = /^n(\d+) (\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/.exec(line);
      if (!m) continue;
      const rest = m[6];
      const ref = k => { const r = new RegExp(` ${k}=([n#f]\\d+)`).exec(rest); return r ? r[1] : undefined; };
      nodes.push({ kind: m[2], pos: Number(m[3]), end: Number(m[4]), flags: Number(m[5]), parent: ref("parent"), name: ref("name"), sym: ref("sym") });
    } else if (section === "symbols") {
      const m = /^(#\d+) ("(?:[^"\\]|\\.)*") f=(0x[0-9a-f]+).* decls=\[([^\]]*)\]/.exec(line);
      if (!m) continue;
      symbols.set(m[1], { name: m[2], flags: Number(m[3]), decls: m[4] === "" ? [] : m[4].split(" ") });
    }
  }
  return { nodes, symbols };
}

// Positions of the reference are byte offsets in UTF-8. Lines end like in ECMAScript, characters are UTF-16 code units.
export class Positions {
  constructor(source) {
    this.source = source;
    this.bytes = Buffer.from(source, "utf8");
    this.lineStarts16 = ts.computeLineStarts(source);
    this.ascii = this.bytes.length === source.length;
  }
  to16(pos8) { return this.ascii ? pos8 : this.bytes.subarray(0, pos8).toString("utf8").length; }
  lineAndCharacter(pos8) {
    const pos16 = this.to16(pos8);
    let lo = 0, hi = this.lineStarts16.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.lineStarts16[mid] <= pos16) lo = mid; else hi = mid - 1; }
    return [lo, pos16 - this.lineStarts16[lo]];
  }
  skipTrivia16(pos8) { return ts.skipTrivia(this.source, this.to16(pos8)); }
  text(pos8, end8) { return this.source.slice(this.skipTrivia16(pos8), this.to16(end8)); }
}

export function declarationLines(dump, positions, fileBaseName) {
  const out = [];
  const index = r => Number(r.slice(1));
  for (const parent of dump.nodes) {
    if (parent.kind === "KindSourceFile" || !parent.sym || !parent.name) continue;
    const name = dump.nodes[index(parent.name)];
    if (!name || name.kind === "KindObjectBindingPattern" || name.kind === "KindArrayBindingPattern") continue;
    if (name.flags & (REPARSED | IN_WITH_STATEMENT)) continue;
    const symbol = dump.symbols.get(parent.sym);
    if (!symbol || symbol.name === '"\\xFEcomputed"') continue;
    const start16 = positions.skipTrivia16(name.pos);
    const line = ts.computeLineAndCharacterOfPosition(positions.lineStarts16, start16).line;
    const text = positions.text(name.pos, name.end).replace(/\r?\n/g, "");
    const decls = symbol.decls.slice(0, 5).map(r => {
      const d = dump.nodes[index(r)];
      const [l, c] = positions.lineAndCharacter(d.pos);
      return `Decl(${fileBaseName}, ${l}, ${c})`;
    });
    const more = symbol.decls.length > 5 ? ` ... and ${symbol.decls.length - 5} more` : "";
    // The printed name ends with the symbol's own name when that name is a plain identifier written as such in the first declaration.
    let own = /^"([A-Za-z_$][A-Za-z0-9_$]*)"$/.exec(symbol.name)?.[1];
    if (own === "default" || symbol.decls.length === 0) own = undefined;
    if (own !== undefined) {
      const first = dump.nodes[index(symbol.decls[0])];
      const firstName = first?.name ? dump.nodes[index(first.name)] : undefined;
      if (!firstName || firstName.kind !== "KindIdentifier" || positions.text(firstName.pos, firstName.end) !== own) own = undefined;
    }
    out.push({ node: parent.name, line, text, decls, more, own });
  }
  out.sort((a, b) => index(a.node) - index(b.node));
  return out;
}

export function checkAgainstBaseline(expected, baselineLines, fileBaseName) {
  const problems = [];
  const used = new Set();
  let checked = 0, named = 0;
  for (const e of expected) {
    let found = false, seen = false, last = "";
    for (let i = 0; i < baselineLines.length; i++) {
      const b = baselineLines[i];
      if (b.line !== e.line || b.text !== e.text) continue;
      seen = true; last = b.symbol;
      if (used.has(i)) continue;
      const got = [...b.symbol.matchAll(/Decl\(([^,()]+), (--|\d+), (--|\d+)\)/g)];
      const foreign = got.some(m => m[1] !== fileBaseName || m[2] === "--");
      const own = got.filter(m => m[1] === fileBaseName && m[2] !== "--").map(m => m[0]);
      let want = e.decls;
      if (foreign && own.length < want.length) want = want.slice(0, own.length);
      if (own.length !== want.length || own.some((d, k) => d !== want[k])) continue;
      if (!foreign && !b.symbol.endsWith(e.more + ")")) continue;
      used.add(i); found = true;
      const comma = b.symbol.indexOf(", Decl(");
      const display = b.symbol.slice("Symbol(".length, comma >= 0 ? comma : b.symbol.length - 1);
      if (e.own !== undefined) {
        named++;
        if (display !== e.own && !display.endsWith("." + e.own)) problems.push(`line ${e.line} ${JSON.stringify(e.text)}: the name ${display} does not end with ${e.own}`);
      }
      break;
    }
    checked++;
    if (!seen) problems.push(`line ${e.line} ${JSON.stringify(e.text)}: the baseline has no line for this declaration name`);
    else if (!found) problems.push(`line ${e.line} ${JSON.stringify(e.text)}: want ${e.decls.join(", ")}${e.more}, the baseline has ${last}`);
  }
  return { checked, named, problems };
}

if (import.meta.main) {
  const [selection, unitsDir, dumpsDir] = process.argv.slice(2);
  let files = 0, checked = 0, named = 0, bad = 0, lines = 0;
  for (const row of fs.readFileSync(selection, "utf8").split("\n").filter(Boolean)) {
    const f = row.split("\t");
    const [id, rel, suite, stem, , unit] = f;
    const virtual = f[12];
    const source = fs.readFileSync(path.join(unitsDir, virtual), "utf8");
    const dump = parseDump(fs.readFileSync(path.join(dumpsDir, virtual.replaceAll("/", "__") + ".bind.txt"), "utf8"));
    const baseline = parseSymbolsBaseline(fs.readFileSync(path.join(BASE, suite, stem + ".symbols"), "utf8"), unit, source);
    if (!baseline.ok) { console.log("cannot read the baseline of", id, baseline.why); bad++; continue; }
    const base = path.basename(virtual);
    const r = checkAgainstBaseline(declarationLines(dump, new Positions(source), base), baseline.lines, base);
    files++; checked += r.checked; named += r.named; lines += baseline.lines.length;
    if (r.problems.length) { bad++; console.log(id, r.problems.slice(0, 3).join("\n   ")); }
  }
  console.log(JSON.stringify({ files, declarationNamesChecked: checked, namesChecked: named, baselineResultLines: lines, filesWithProblems: bad }));
}
