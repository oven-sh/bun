// Compares the rules "tsc" of the port with the code of TypeScript's own harness (groundtruth/ts_harness.cjs).
// usage: bun crosscheck_tsc.ts <count> [seed] [mild]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { type TestFile, getErrorBaseline } from "./error_baseline";

const count = Number(process.argv[2] ?? "1000");
let seed = Number(process.argv[3] ?? "1");
const mild = process.argv[4] === "mild";
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
const b64 = (s: string): string => Buffer.from(s, "latin1").toString("base64");
const wild = [
  "a", "b", "foo", " ", "  ", "\t", "\n", "\n", "\n", "\r\n", "\r", utf8("\u2028"), utf8("\u2029"), utf8("\u00a0"), "\v", "\f",
  utf8("\u00e9"), utf8("\u4e2d"), utf8("\u{1d608}"), utf8("\u{1d608}"), utf8("\ufeff"), utf8("\u0085"), utf8("\u3000"), "~", "!!! error TS1: x", "==== a.ts (1 errors) ====",
  "/.src/", "/.ts/", "bundled:///libs/", "file:///.ts/", "lib.d.ts(1,2)", "x;", "{", "}", "",
];
const pieces = mild ? wild.filter(p => !/\r|\xe2\x80[\xa8\xa9]/.test(p)) : wild;
const text = (n: number): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += pick(pieces);
  return s;
};
const names = ["/.src/a.ts", "/.src/b.ts", "/.src/dir/c.tsx", "/.src/lib.d.ts", "/.src/lib/x.d.ts", "/.src/tsconfig.json", "/abs/d.ts", "/.ts/lib.es5.d.ts", "/.lib/react.d.ts", "file:///.ts/lib.es2015.d.ts", "c:/root/e.ts"];
const messages = ["Message.", "Type 'a' is not assignable to type 'b'.", "With /.src/x.ts and file:///.lib/y.ts and /.ts/z.ts", "Two\nlines", "Two\r\nlines", utf8("caf\u00e9 \u{1d608}"), "see lib.d.ts:1:2 and lib.es5.d.ts:3:4"];

interface Case {
  name: string;
  pretty: boolean;
  inputs: TestFile[];
  diagnostics: Diagnostic[];
  files: FileLike[];
}
const cases: Case[] = [];
for (let n = 0; n < count; n++) {
  const fileCount = 1 + int(3);
  const used = new Set<string>();
  const all: FileLike[] = [];
  const pretty = rnd() < 0.3;
  for (let i = 0; i < fileCount + (pretty ? 0 : 1); i++) {
    let name = pick(names);
    while (used.has(name)) name = pick(names);
    used.add(name);
    all.push({ fileName: name, text: text(int(30)) });
  }
  const inputs: TestFile[] = all.slice(0, fileCount).map(f => ({ unitName: f.fileName, content: f.text }));
  const position = (f: FileLike, p: number): number => {
    // A rune boundary, or the middle of a rune of four bytes, which stands for the place between its two halves.
    while (p > 0 && p < f.text.length && (f.text.charCodeAt(p) & 0xc0) === 0x80) {
      if (p >= 2 && f.text.charCodeAt(p - 2) >= 0xf0 && rnd() < 0.5) return p;
      p--;
    }
    return p;
  };
  const seen = new Set<string>();
  const makeDiag = (depth: number): Diagnostic | undefined => {
    const file = rnd() < 0.1 ? undefined : pick(all);
    let pos = 0;
    let end = 0;
    if (file !== undefined) {
      pos = position(file, int(file.text.length + 1));
      end = position(file, Math.min(file.text.length, pos + (rnd() < 0.3 ? 0 : int(12))));
      if (end < pos) end = pos;
    }
    const code = pick([1005, 2322, 2345, 1490, 6203, 7006, 2304]);
    if (depth === 0) {
      const key = `${file?.fileName}:${pos}:${end}:${code}`;
      const keyStart = `${file?.fileName}:${code}`;
      if (seen.has(key) || (file === undefined && seen.has(keyStart))) return undefined;
      seen.add(key);
      seen.add(keyStart);
    }
    const chain: Diagnostic[] = [];
    if (depth < 3) for (let i = int(3) - 1; i > 0; i--) chain.push({ ...makeDiag(depth + 1)!, file: undefined, relatedInformation: [] });
    const related: Diagnostic[] = [];
    if (depth === 0) for (let i = int(3) - 1; i > 0; i--) related.push({ ...makeDiag(1)!, relatedInformation: [] });
    // TypeScript fails on the category suggestion in the pretty format.
    return { file, pos, end, code, category: pick(pretty ? [0, 1, 1, 1, 3] : [0, 1, 1, 1, 2, 3]), source: "", message: pick(messages), messageChain: chain, relatedInformation: related };
  };
  const diagnostics: Diagnostic[] = [];
  for (let i = 1 + int(5); i > 0; i--) {
    const d = makeDiag(0);
    if (d !== undefined) diagnostics.push(d);
  }
  if (diagnostics.length === 0) continue;
  diagnostics.sort((a, b) => {
    const pa = a.file?.fileName ?? "";
    const pb = b.file?.fileName ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : a.pos - b.pos || a.end - b.end || a.code - b.code;
  });
  cases.push({ name: "tsfuzz" + n, pretty, inputs, diagnostics, files: all });
}

const toJson = (c: Case): string => {
  const files: FileLike[] = [];
  const index = (f: FileLike | undefined): number => (f === undefined ? -1 : files.indexOf(f) >= 0 ? files.indexOf(f) : files.push(f) - 1);
  const conv = (d: Diagnostic): unknown => ({ file: index(d.file), pos: d.pos, end: d.end, code: d.code, category: d.category, source: d.source, message: b64(d.message), chain: d.messageChain.map(conv), related: d.relatedInformation.map(conv) });
  const diagnostics = c.diagnostics.map(conv);
  return JSON.stringify({ name: c.name, pretty: c.pretty, files: files.map(f => ({ name: b64(f.fileName), text: b64(f.text) })), inputs: c.inputs.map(f => ({ name: b64(f.unitName), text: b64(f.content) })), diagnostics });
};
const input = "/tmp/ebf/tsfuzz.in.jsonl";
writeFileSync(input, cases.map(toJson).join("\n") + "\n");
const r = spawnSync("node", [join(import.meta.dir, "../groundtruth/ts_harness.cjs"), "/workspace/ref/typescript-go/_submodules/TypeScript", "/workspace/bun/node_modules/typescript/lib/typescript.js", input], { maxBuffer: 1 << 30, encoding: "utf8" });
if (r.status !== 0) throw new Error("ground truth failed: " + r.stderr.slice(0, 2000));
const results = r.stdout.split("\n").filter(l => l !== "").map(l => JSON.parse(l) as { text: string; failed: string[]; panic: string; skipped: string });
const vectorsAt = process.argv.indexOf("--vectors");
if (vectorsAt >= 0) {
  const lines = cases.map((c, i) => JSON.stringify({ ...JSON.parse(toJson(c)), rules: "tsc", expected: { text: results[i].text, failed: results[i].failed, panic: results[i].panic } }));
  writeFileSync(process.argv[vectorsAt + 1], lines.join("\n") + "\n");
}
let same = 0;
let bothStop = 0;
const stops = new Map<string, number>();
const bad: string[] = [];
cases.forEach((c, i) => {
  const g = results[i];
  const want = Buffer.from(g.text, "base64").toString("latin1");
  let mine: string | undefined;
  let thrown = "";
  try {
    mine = getErrorBaseline(c.inputs, c.diagnostics, (a, b) => c.diagnostics.indexOf(a) - c.diagnostics.indexOf(b), c.pretty, "tsc").text;
  } catch (e) {
    thrown = (e as Error).message;
  }
  if (g.panic !== "" || thrown !== "") {
    if (g.panic !== "" && thrown !== "") {
      bothStop++;
      const key = `${c.pretty ? "pretty" : "plain"}: TypeScript ${g.panic.replace(/\d+/g, "N").slice(0, 60)} / port ${thrown.replace(/\d+/g, "N").slice(0, 60)}`;
      stops.set(key, (stops.get(key) ?? 0) + 1);
    } else bad.push(`${c.name}${c.pretty ? " pretty" : ""}: TypeScript stops with ${JSON.stringify(g.panic.slice(0, 200))}, the port with ${JSON.stringify(thrown)}`);
    return;
  }
  if (mine !== want) {
    let at = 0;
    while (at < want.length && at < mine!.length && want[at] === mine![at]) at++;
    bad.push(`${c.name}${c.pretty ? " pretty" : ""}: differs at byte ${at}: TypeScript ${JSON.stringify(want.slice(Math.max(0, at - 50), at + 40))} port ${JSON.stringify(mine!.slice(Math.max(0, at - 50), at + 40))}`);
    return;
  }
  same++;
});
console.log(`== tsc rules: ${cases.length} cases; same bytes ${same}; both stop ${bothStop}; different ${bad.length}`);
for (const [k, v] of stops) console.log(`   stop x${v}: ${k}`);
const kinds = new Map<string, number>();
for (const b of bad) {
  const k = b.replace(/^tsfuzz\d+/, "").replace(/\d+/g, "N").slice(0, 100);
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
for (const b of bad.slice(0, 12)) console.log("   " + b.slice(0, 600));
