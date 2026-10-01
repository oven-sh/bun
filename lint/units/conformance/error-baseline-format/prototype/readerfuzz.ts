// Property of the reader on made-up cases: write(read(write(case))) is write(case), with and without the units.
// usage: bun readerfuzz.ts <count> [seed]
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { type TestFile, getErrorBaseline } from "./error_baseline";
import { BaselineReadError, type ParsedDiagnostic, readErrorBaseline } from "./reader";

const count = Number(process.argv[2] ?? "2000");
let seed = Number(process.argv[3] ?? "1");
const rnd = (): number => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
};
const pick = <X>(xs: X[]): X => xs[Math.floor(rnd() * xs.length)];
const int = (n: number): number => Math.floor(rnd() * n);
const utf8 = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
const pieces = ["a", "b", "foo", " ", "  ", "    ", "\t", "\n", "\n", "\n", utf8("\u00a0"), "\v", "\f", utf8("\u00e9"), utf8("\u4e2d"), utf8("\u{1d608}"), "~", "~~~", "!!! error TS1: x", "==== a.ts (1 errors) ====", "x;", "{", "}", "", "Found 1 error."];
const text = (n: number): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += pick(pieces);
  return s;
};
const names = ["/.src/a.ts", "/.src/b.ts", "/.src/dir/c.tsx", "/.src/tsconfig.json", "/abs/d.ts", "c:/root/e.ts"];
const outside = ["bundled:///libs/lib.es5.d.ts", "/.lib/react16.d.ts"];
const messages = ["Message.", "Type 'a' is not assignable to type 'b'.", "With /.src/x.ts path", "Two\nlines", "Two\r\nlines", utf8("caf\u00e9 \u{1d608}")];
const byOrder = (a: Diagnostic, b: Diagnostic): number => (a as ParsedDiagnostic).order - (b as ParsedDiagnostic).order;

let shown = false;
let ok = 0;
let okUnits = 0;
let writerStops = 0;
const bad: string[] = [];
const ambiguous = { n: 0 };
for (let n = 0; n < count; n++) {
  const pretty = rnd() < 0.25;
  const fileCount = 1 + int(3);
  const used = new Set<string>();
  const inputs: FileLike[] = [];
  for (let i = 0; i < fileCount; i++) {
    let name = pick(names);
    while (used.has(name)) name = pick(names);
    used.add(name);
    inputs.push({ fileName: name, text: text(int(30)) });
  }
  const others: FileLike[] = pretty ? [] : outside.map(name => ({ fileName: name, text: text(20) }));
  const all = [...inputs, ...others];
  const boundary = (f: FileLike, p: number): number => {
    while (p > 0 && p < f.text.length && (f.text.charCodeAt(p) & 0xc0) === 0x80) p--;
    return p;
  };
  const makeDiag = (depth: number, allowOutside: boolean): Diagnostic => {
    const file = rnd() < 0.1 ? undefined : pick(allowOutside ? all : inputs);
    let pos = 0;
    let end = 0;
    if (file !== undefined) {
      pos = boundary(file, int(file.text.length + 1));
      end = boundary(file, Math.min(file.text.length, pos + (rnd() < 0.3 ? 0 : int(12))));
      if (end < pos) end = pos;
    }
    const chain: Diagnostic[] = [];
    if (depth < 3) for (let i = int(3) - 1; i > 0; i--) chain.push({ ...makeDiag(depth + 1, false), file: undefined, relatedInformation: [] });
    const related: Diagnostic[] = [];
    if (depth === 0) for (let i = int(3) - 1; i > 0; i--) related.push({ ...makeDiag(1, true), category: 3, relatedInformation: [] });
    return { file, pos, end, code: pick([1005, 2322, 2345, 6203]), category: pick([0, 1, 1, 1, 2, 3]), source: "", message: pick(messages), messageChain: chain, relatedInformation: related };
  };
  const diagnostics: Diagnostic[] = [];
  for (let i = 1 + int(5); i > 0; i--) diagnostics.push(makeDiag(0, true));
  diagnostics.sort((a, b) => {
    const pa = a.file?.fileName ?? "";
    const pb = b.file?.fileName ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : a.pos - b.pos || a.end - b.end || a.code - b.code;
  });
  const testFiles: TestFile[] = inputs.map(f => ({ unitName: f.fileName, content: f.text }));
  let first: string;
  try {
    first = getErrorBaseline(testFiles, diagnostics, (a, b) => diagnostics.indexOf(a) - diagnostics.indexOf(b), pretty, "tsgo").text;
  } catch {
    writerStops++;
    continue;
  }
  for (const withUnits of [false, true]) {
    try {
      const parsed = readErrorBaseline(first, { rules: "tsgo", units: withUnits ? testFiles : undefined });
      const second = getErrorBaseline(parsed.files, parsed.diagnostics, byOrder, parsed.pretty, "tsgo").text;
      if (second !== first) {
        let at = 0;
        while (at < first.length && first[at] === second[at]) at++;
        bad.push(`case ${n} (${withUnits ? "units" : "no units"}${pretty ? ", pretty" : ""}): differs at ${at}: ${JSON.stringify(first.slice(Math.max(0, at - 60), at + 40))} against ${JSON.stringify(second.slice(Math.max(0, at - 60), at + 40))}`);
        continue;
      }
      if (withUnits) {
        // With the units the reader gives back the text and the spans of the case.
        const same = parsed.files.every((f, i) => f.content === testFiles[i].content);
        const spans = diagnostics.every((d, i) => d.file === undefined || others.includes(d.file) || (parsed.diagnostics[i].pos === d.pos && parsed.diagnostics[i].end === d.end));
        if (!same || !spans) {
          bad.push(`case ${n} (units${pretty ? ", pretty" : ""}): ${same ? "" : "text differs "}${spans ? "" : "spans differ: " + JSON.stringify(diagnostics.map((d, i) => [d.pos, d.end, parsed.diagnostics[i].pos, parsed.diagnostics[i].end]))}`);
          continue;
        }
        okUnits++;
      } else {
        ok++;
        if (parsed.ambiguities.length > 0) ambiguous.n++;
      }
    } catch (e) {
      if (!(e instanceof BaselineReadError) && !(e instanceof RangeError)) throw e;
      bad.push(`case ${n} (${withUnits ? "units" : "no units"}${pretty ? ", pretty" : ""}): read: ${(e as Error).message}`);
      if (process.env.DEBUG_MATCH && (e as Error).message.includes(process.env.DEBUG_MATCH) && !shown) {
        shown = true;
        console.log(first.replace(/\x1b/g, "\u241b").replace(/\r\n/g, "\u240d\n"));
        console.log((e as Error).stack);
      }
    }
  }
}
console.log({ count, writerStops, ok, okUnits, ambiguous: ambiguous.n, bad: bad.length });
const kinds = new Map<string, number>();
for (const b of bad) {
  const k = b.replace(/^case \d+ /, "").replace(/\d+/g, "N").slice(0, 110);
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  x${v} ${k}`);
for (const b of bad.slice(0, 6)) console.log("  " + b.slice(0, 500));
