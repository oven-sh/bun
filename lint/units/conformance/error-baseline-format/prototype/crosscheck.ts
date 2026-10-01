// Compares the port of the writer with the reference's own code (groundtruth/build.py) on the same inputs.
// usage: bun crosscheck.ts corpus <gt binary> | bun crosscheck.ts fuzz <gt binary> <count> [seed]
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { type TestFile, getErrorBaseline } from "./error_baseline";
import { BaselineReadError, type ParsedDiagnostic, readErrorBaseline } from "./reader";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const mode = process.argv[2];
const gt = process.argv[3];

const b64 = (s: string): string => Buffer.from(s, "latin1").toString("base64");

interface Case {
  name: string;
  pretty: boolean;
  inputs: TestFile[];
  diagnostics: Diagnostic[];
  expected?: string;
}

function toJson(c: Case): string {
  const files: FileLike[] = [];
  const index = (f: FileLike | undefined): number => {
    if (f === undefined) return -1;
    let i = files.indexOf(f);
    if (i < 0) {
      i = files.length;
      files.push(f);
    }
    return i;
  };
  const conv = (d: Diagnostic): unknown => ({
    file: index(d.file),
    pos: d.pos,
    end: d.end,
    code: d.code,
    category: d.category,
    source: d.source,
    message: b64(d.message),
    chain: d.messageChain.map(conv),
    related: d.relatedInformation.map(conv),
  });
  const diagnostics = c.diagnostics.map(conv);
  return JSON.stringify({
    name: c.name,
    pretty: c.pretty,
    files: files.map(f => ({ name: b64(f.fileName), text: b64(f.text) })),
    inputs: c.inputs.map(f => ({ name: b64(f.unitName), text: b64(f.content) })),
    diagnostics,
  });
}

const byOrder = (a: Diagnostic, b: Diagnostic): number => (a as ParsedDiagnostic).order - (b as ParsedDiagnostic).order;
const byIndex = (list: Diagnostic[]) => (a: Diagnostic, b: Diagnostic): number => list.indexOf(a) - list.indexOf(b);

function runAll(cases: Case[], label: string): void {
  const input = `/tmp/ebf/${label}.in.jsonl`;
  const inputLines = cases.map(toJson);
  writeFileSync(input, inputLines.join("\n") + "\n");
  const r = spawnSync(gt, [input], { maxBuffer: 1 << 30, encoding: "utf8" });
  if (r.status !== 0) throw new Error("ground truth failed: " + r.stderr);
  const results = r.stdout
    .split("\n")
    .filter(l => l !== "")
    .map(l => JSON.parse(l) as { name: string; text: string; failed: string[] | null; panic: string });
  if (results.length !== cases.length) throw new Error(`${results.length} results for ${cases.length} cases`);
  const vectorsAt = process.argv.indexOf("--vectors");
  if (vectorsAt >= 0) {
    // One line per case: the input of the writer and what the reference's code makes of it.
    const lines = inputLines.map((line, i) => JSON.stringify({ ...JSON.parse(line), expected: { text: results[i].text, failed: results[i].failed ?? [], panic: results[i].panic } }));
    writeFileSync(process.argv[vectorsAt + 1], lines.join("\n") + "\n");
  }
  let same = 0;
  let samePanic = 0;
  let sameExpected = 0;
  const stops = new Map<string, number>();
  const bad: string[] = [];
  cases.forEach((c, i) => {
    const g = results[i];
    const goText = Buffer.from(g.text, "base64").toString("latin1");
    let mine: string | undefined;
    let thrown = "";
    let failedChecks: string[] = [];
    try {
      const w = getErrorBaseline(c.inputs, c.diagnostics, c.expected !== undefined ? byOrder : byIndex(c.diagnostics), c.pretty, "tsgo");
      mine = w.text;
      failedChecks = w.failedChecks;
    } catch (e) {
      thrown = (e as Error).message;
    }
    if (g.panic !== "" || thrown !== "") {
      if (g.panic !== "" && thrown !== "") {
        samePanic++;
        const key = `${c.pretty ? "pretty" : "plain"}: reference ${g.panic.replace(/\d+/g, "N")} / port ${thrown.replace(/\d+/g, "N")}`;
        stops.set(key, (stops.get(key) ?? 0) + 1);
      }
      else bad.push(`${c.name}: reference panic ${JSON.stringify(g.panic)}, port throws ${JSON.stringify(thrown)}`);
      return;
    }
    if (mine !== goText) {
      let at = 0;
      while (at < goText.length && at < mine!.length && goText[at] === mine![at]) at++;
      bad.push(`${c.name}: differs at byte ${at}: reference ${JSON.stringify(goText.slice(Math.max(0, at - 40), at + 40))} port ${JSON.stringify(mine!.slice(Math.max(0, at - 40), at + 40))}`);
      return;
    }
    const goFailed = (g.failed ?? []).length;
    if (goFailed !== failedChecks.length) {
      bad.push(`${c.name}: the reference fails ${goFailed} checks (${(g.failed ?? []).join("; ")}) and the port ${failedChecks.length} (${failedChecks.join("; ")})`);
      return;
    }
    same++;
    if (c.expected !== undefined && c.expected === goText) sameExpected++;
  });
  console.log(`== ${label}: ${cases.length} cases; same bytes and same checks ${same}; both stop ${samePanic}; different ${bad.length}`);
  if (cases.some(c => c.expected !== undefined)) console.log(`   the reference writer gives back the baseline in ${sameExpected} cases`);
  for (const [k, v] of stops) console.log(`   stop x${v}: ${k}`);
  for (const b of bad.slice(0, 30)) console.log("   " + b.slice(0, 700));
}

if (mode === "corpus") {
  const list = (dir: string): string[] =>
    readdirSync(dir)
      .filter(f => f.endsWith(".errors.txt"))
      .sort()
      .map(f => join(dir, f));
  for (const [label, files] of [
    ["go", [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))]],
    ["ts", list(TS)],
  ] as [string, string[]][]) {
    const cases: Case[] = [];
    let unread = 0;
    for (const f of files) {
      const text = readFileSync(f).toString("latin1");
      try {
        const parsed = readErrorBaseline(text, { rules: "tsgo" });
        cases.push({ name: basename(f), pretty: parsed.pretty, inputs: parsed.files, diagnostics: parsed.diagnostics, expected: text });
      } catch (e) {
        if (!(e instanceof BaselineReadError)) throw e;
        unread++;
      }
    }
    console.log(`${label}: ${unread} baselines do not read with the Go rules`);
    runAll(cases, "corpus-" + label);
  }
} else if (mode === "fuzz") {
  const count = Number(process.argv[4] ?? "1000");
  let seed = Number(process.argv[5] ?? "1");
  const rnd = (): number => {
    // xorshift32
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
  const mild = process.argv[6] === "mild";
  const wild = [
    "a", "b", "foo", " ", "  ", "\t", "\n", "\n", "\n", "\r\n", "\r", utf8("\u2028"), utf8("\u2029"), utf8("\u00a0"), "\v", "\f",
    utf8("\u00e9"), utf8("\u4e2d"), utf8("\u{1d608}"), utf8("\ufeff"), utf8("\u0085"), "\xff", "\xf0\x9d", "\xc3", "~", "!!! error TS1: x", "==== a.ts (1 errors) ====",
    "/.src/", "/.ts/", "bundled:///libs/", "file:///./ts/", "file:///.ts/", "lib.d.ts(1,2)", "x;", "{", "}", "",
  ];
  // Without the line breaks that the split on LF does not see, where the reference stops.
  const pieces = mild ? wild.filter(p => !/\r|\xe2\x80[\xa8\xa9]/.test(p)) : wild;
  const names = mild
    ? ["/.src/a.ts", "/.src/b.ts", "/.src/dir/c.tsx", "/.src/lib.d.ts", "/.src/lib/x.d.ts", "/.src/tsconfig.json", "/abs/d.ts", "bundled:///libs/lib.es5.d.ts", "/.lib/react.d.ts", "/.ts/lib.es2015.d.ts", "c:/root/e.ts", "rel.ts"]
    : ["/.src/a.ts", "/.src/A.ts", "/.src/b.ts", "/.src/dir/c.tsx", "/.src/lib.d.ts", "/.src/lib/x.d.ts", "/.src/tsconfig.json", "/abs/d.ts", "bundled:///libs/lib.es5.d.ts", "/.lib/react.d.ts", "/.ts/lib.es2015.d.ts", "c:/root/e.ts", "/.src/a/../f.ts", "rel.ts"];
  const text = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += pick(pieces);
    return s;
  };
  const messages = ["Message.", "Type 'a' is not assignable to type 'b'.", "With /.src/x.ts path", "Two\nlines", "Two\r\nlines", "", "  indented", utf8("caf\u00e9 \u{1d608}"), "bundled:///libs/lib.d.ts:1:2"];
  const cases: Case[] = [];
  for (let n = 0; n < count; n++) {
    const fileCount = 1 + int(3);
    const used = new Set<string>();
    const all: FileLike[] = [];
    for (let i = 0; i < fileCount + 1; i++) {
      let name = pick(names);
      while (used.has(name)) name = pick(names);
      used.add(name);
      all.push({ fileName: name, text: text(int(30)) });
    }
    // The last file has no section, and with some chance a section has the text of another version of the file.
    const inputs: TestFile[] = all.slice(0, fileCount).map(f => ({ unitName: f.fileName, content: f.text }));
    const safe = mild || rnd() < 0.85;
    const makeDiag = (depth: number): Diagnostic => {
      const file = rnd() < 0.1 ? undefined : pick(all);
      let pos = 0;
      let end = 0;
      if (file !== undefined) {
        const len = file.text.length;
        pos = int(len + 1);
        end = pos + (rnd() < 0.3 ? 0 : int(Math.min(12, len - pos + 1)));
        if (!safe && rnd() < 0.3) end = pos + int(40);
        if (end > len && safe) end = len;
        if (safe) {
          // A span of the checker starts and ends on a rune boundary.
          const isBoundary = (p: number) => p >= len || (file.text.charCodeAt(p) & 0xc0) !== 0x80;
          while (!isBoundary(pos)) pos--;
          while (!isBoundary(end)) end++;
          if (end < pos) end = pos;
        }
      }
      const chain: Diagnostic[] = [];
      if (depth < 3) for (let i = int(3) - 1; i > 0; i--) chain.push({ ...makeDiag(depth + 1), file: undefined, relatedInformation: [] });
      const related: Diagnostic[] = [];
      if (depth === 0) for (let i = int(3) - 1; i > 0; i--) related.push({ ...makeDiag(1), relatedInformation: [] });
      return { file, pos, end, code: pick([1005, 2322, 2345, -1, 1490, 6203]), category: pick([0, 1, 1, 1, 2, 3]), source: "", message: pick(messages), messageChain: chain, relatedInformation: related };
    };
    const diagnostics: Diagnostic[] = [];
    for (let i = 1 + int(5); i > 0; i--) diagnostics.push(makeDiag(0));
    // The writer gets its diagnostics sorted by file and position, as the program gives them.
    diagnostics.sort((a, b) => {
      const pa = a.file?.fileName ?? "";
      const pb = b.file?.fileName ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : a.pos - b.pos || a.end - b.end || a.code - b.code;
    });
    cases.push({ name: "fuzz" + n, pretty: rnd() < 0.3, inputs, diagnostics });
  }
  runAll(cases, "fuzz");
}
