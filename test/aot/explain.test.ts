// `--aot-explain` and the percentage in the last line of a build are one account:
//   100% means that the report has no entry;
//   the entries' accesses add up to what is missing from 100%;
//   the fix that an entry suggests removes the entry and makes the percentage rise.
// ./explain/<code> and ./explain/<code>.<variant> have a program with one cause (before) and the same program fixed as the entry says (after).
import { expect } from "bun:test";
import { existsSync, readdirSync, renameSync } from "fs";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { describe, test } from "./supported";

interface Entry {
  rank: number;
  code: string;
  file: string;
  line: number;
  column: number;
  start: number;
  end: number;
  inDependency: boolean;
  source: string;
  message: string;
  accesses: number;
  points: number;
  dependencyAccesses: number;
  dependencyPoints: number;
  fix: string;
  edits: { file: string; start: number; end: number; replacement: string }[];
  url: string;
}

const fixtures = join(import.meta.dir, "explain");
const page = join(import.meta.dir, "../../docs/bundler/aot-explain.mdx");

// A folder `packages` of a fixture holds what the program finds in node_modules.
function copyOf(...fixture: string[]) {
  const dir = tempDirWithBunTypes("aot-explain", join(fixtures, ...fixture));
  const packages = join(String(dir), "packages");
  if (existsSync(packages)) for (const name of readdirSync(packages)) renameSync(join(packages, name), join(String(dir), "node_modules", name));
  return dir;
}

async function run(folder: string, ...flags: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "check", "--aot", "--no-pretty", ...flags, "main.ts"], cwd: folder, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function explain(folder: string) {
  const { stdout, stderr, exitCode } = await run(folder, "--aot-explain=json");
  const entries: Entry[] = stdout
    .split("\n")
    .filter(line => line.startsWith('{"rank"'))
    .map(line => JSON.parse(line));
  const summary = /^aot: ([\d.]+)% typed(?: \(([\d,]+) of ([\d,]+) property accesses\))?(?:, dependencies ([\d.]+)% \(([\d,]+) of ([\d,]+)\))?$/m.exec(stdout + stderr);
  const count = (text: string | undefined) => Number((text ?? "0").replaceAll(",", ""));
  return {
    entries,
    percent: Number(summary?.[1]),
    missing: count(summary?.[3]) - count(summary?.[2]),
    dependencyPercent: Number(summary?.[4] ?? 100),
    missingInDependencies: count(summary?.[6]) - count(summary?.[5]),
    said: stdout + stderr,
    exitCode,
  };
}

const codeOf = (folder: string) => folder.split(".")[0]!;
const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0);

describe.concurrent("--aot-explain", () => {
  test.each(readdirSync(fixtures).sort())(
    "%s",
    async folder => {
      using before = copyOf(folder, "before");
      using after = copyOf(folder, "after");
      const [broken, fixed] = await Promise.all([explain(String(before)), explain(String(after))]);
      expect({ exitCode: broken.exitCode, codes: broken.entries.map(entry => entry.code) }).toEqual({ exitCode: 0, codes: [codeOf(folder)] });
      expect({ exitCode: fixed.exitCode, codes: fixed.entries.map(entry => entry.code), percent: fixed.percent, dependencyPercent: fixed.dependencyPercent, said: fixed.said.includes("--aot-explain shows") }).toEqual({ exitCode: 0, codes: [], percent: 100, dependencyPercent: 100, said: false });
      expect(Math.min(broken.percent, broken.dependencyPercent)).toBeLessThan(100);
      expect(sum(broken.entries.map(entry => entry.accesses))).toBe(broken.missing);
      expect(sum(broken.entries.map(entry => entry.dependencyAccesses))).toBe(broken.missingInDependencies);
      for (const entry of broken.entries) {
        expect(entry.points + entry.dependencyPoints).toBeGreaterThan(0);
        expect(entry.fix).not.toBeEmpty();
        expect(entry.url).toBe(`https://bun.com/docs/bundler/aot-explain#${entry.code}`);
      }
    },
    60_000,
  );

  test.each(["json-parse.cast", "json-parse.annotated"])(
    "%s: the edits of the entry are the fix",
    async folder => {
      using dir = copyOf(folder, "before");
      const { entries } = await explain(String(dir));
      expect(entries[0]!.edits).not.toBeEmpty();
      for (const edit of entries[0]!.edits.toSorted((a, b) => b.start - a.start)) {
        const path = join(String(dir), edit.file);
        const bytes = Buffer.from(await Bun.file(path).bytes());
        await Bun.write(path, Buffer.concat([bytes.subarray(0, edit.start), Buffer.from(edit.replacement), bytes.subarray(edit.end)]));
      }
      expect(await Bun.file(join(String(dir), "main.ts")).text()).toBe(await Bun.file(join(fixtures, folder, "after", "main.ts")).text());
    },
    60_000,
  );

  test("every code has a section on the page that the entries link to", async () => {
    const headings = [...(await Bun.file(page).text()).matchAll(/^### ([a-z-]+)$/gm)].map(match => match[1]!);
    const codes = [...(await Bun.file(join(import.meta.dir, "../../src/aot/link/explain.rs")).text()).matchAll(/^ +Code::\w+ => "([a-z-]+)",$/gm)].map(match => match[1]!);
    expect(codes.length).toBeGreaterThan(10);
    expect(headings.toSorted()).toEqual(codes.toSorted());
    for (const folder of readdirSync(fixtures)) expect(codes).toContain(codeOf(folder));
  });

  test("the report as text", async () => {
    using dir = copyOf("json-parse.annotated", "before");
    const [first, second] = [await run(String(dir), "--aot-explain"), await run(String(dir), "--aot-explain")];
    const report = (said: { stdout: string; stderr: string }) => (said.stdout + said.stderr).split("\n").filter(line => !line.includes("No type errors"));
    expect(report(first)).toEqual(report(second));
    expect(report(first)).toEqual([
      "aot: 0.0% typed (0 of 1 property accesses)",
      "aot: 1 cause, the most expensive first. Fix one, then run this again: a fix can uncover another cause behind it.",
      "",
      "  1. json-parse main.ts:12:20: fixing it types up to 1 access (+100.0 points)",
      `     12 | const saved: any = JSON.parse('[{"sku":"A-1","price":2.5}]');`,
      "                             ^~~~~~~~~~",
      "     JSON.parse() returns 'any'.",
      "     main.ts:13:19: The value is used as 'Item[]' here, so the compiler cannot rely on the layout of that type.",
      "     types that lose their layout: 'Item'",
      "     not typed because of it: main.ts:8:36",
      "     fix: write JSON.parse<Item[]>(..) and declare the variable 'Item[]': the value is checked once, here, and is typed from then on. Data that does not match throws a TypeError",
      "     https://bun.com/docs/bundler/aot-explain#json-parse",
      "aot: 0.0% typed (0 of 1 property accesses)",
      "",
    ]);
  }, 60_000);

  test("=json begins with the numbers", async () => {
    using dir = copyOf("class-layout.mixin", "before");
    const { stdout } = await run(String(dir), "--aot-explain=json");
    expect(JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))!)).toEqual({ percent: 25, typed: 1, accesses: 4, dependencyPercent: 100, typedInDependencies: 0, dependencyAccesses: 0, causes: 1 });
  }, 60_000);

  test("what is left out is counted, with the flag that prints it", async () => {
    const functions = Array.from({ length: 25 }, (_, i) => `export function f${i}(value: any): number {\n  return value.n${i};\n}\n`).join("");
    using dir = tempDirWithBunTypes("aot-explain-many", { "main.ts": `${functions}console.log(${Array.from({ length: 25 }, (_, i) => `f${i}({ n${i}: 1 })`).join(" + ")});\n` });
    const { stdout, stderr } = await run(String(dir), "--aot-explain");
    const lines = (stdout + stderr).split("\n");
    expect(lines.filter(line => /^ +\d+\. /.test(line))).toHaveLength(20);
    expect(lines).toContain(" 5 more causes are not shown. With =json after the flag, every one is printed, one object per line.");
    expect((await explain(String(dir))).entries).toHaveLength(25);
  }, 60_000);
});
