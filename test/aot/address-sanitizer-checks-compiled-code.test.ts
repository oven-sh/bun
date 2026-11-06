import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Without a write barrier the young collection does not visit the old objects again, so the new leaves are dead, and poisoned, after it.
const leaves = (read: string) => `import { edenGC, fullGC } from "bun:jsc";
interface Leaf { v: number; w: number }
interface Inner { r: Leaf; n: number }
interface Outer { a: Inner; id: number }
const kept: Outer[] = [];
function make(i: number): Outer { return { a: { r: { v: 0, w: 0 }, n: i }, id: i }; }
${read}
for (let i = 0; i < 4000; i++) kept.push(make(i));
fullGC();
for (let i = 0; i < kept.length; i++) kept[i].a.r = { v: i, w: -i };
edenGC();
let sum = 0;
for (let i = 0; i < kept.length; i++) sum += read(kept[i].a.r);
console.log(sum);
`;
const staleCells = ["--aot-sabotage=StoresNeedNoBarrier"];
const typedRead = "function read(leaf: Leaf): number { return leaf.v; }";
const looseEquality = `function same(x: any, y: any): boolean { return x == y; }
const mixed: any[] = [{ v: 1 }, 1, "s", function () {}, undefined, null];
let warm = 0;
for (const m of mixed) for (const n of mixed) warm += same(m, n) ? 1 : 0;
function read(leaf: any): number { return same(leaf, "x") ? 1 : 2; }`;

const rows: [string, string, string, string[], RegExp][] = [
  ["code that B3 generates", typedRead, "7998000\n", ["--aot-heat=everything-is-hot"], /poisoned memory: function \d+/],
  ["a stub", looseEquality, "8000\n", ["--aot-heat=everything-is-hot"], /poisoned memory: a stub/],
];

test.skipIf(!isASAN || !isLinux || process.arch !== "x64").each(rows)(
  "AddressSanitizer reports a read of a dead cell by %s",
  async (_, read, expected, flags, report) => {
    using dir = tempDir("asan-compiled-code", { "entry.ts": leaves(read) });
    for (const sabotage of [[], staleCells]) {
      const executable = join(String(dir), sabotage.length ? "sabotaged" : "sound");
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", ...sabotage, ...flags, "entry.ts", "--outfile", executable],
        String(dir),
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });

      const { stdout, stderr, exitCode } = await run([executable], String(dir), {
        ...bunEnv,
        ASAN_OPTIONS: bunEnv.ASAN_OPTIONS + ":symbolize=0",
      });
      if (!sabotage.length) {
        expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
        continue;
      }
      expect(stderr).toMatch(report);
      expect(stderr).toContain("AddressSanitizer: use-after-poison");
      expect(exitCode).not.toBe(0);
    }
  },
  240_000,
);

// Every other cell of a block is never allocated and stays poisoned. --aot-testing=ProveEverything takes the declared type for
// proven, so `held.c` of a Short is read behind the end of its cell.
const shorterObject = `class Long { a = 1.5; b = 2.5; c = 3.5; d = 4.5; e = 5.5; f = 6.5; g = 7.5; h = 8.5; }
class Short { a = 1.5; }
function read(held: Long): number { return held.c; }
const values: unknown[] = [];
for (let i = 0; i < 64; i++) values.push(i & 1 ? new Short() : new Long());
let sum = 0;
for (let i = 0; i < values.length; i++) sum += read(values[i] as Long) > 0 ? 1 : 0;
console.log(sum);
`;

// The pinned engine does not have those cells yet.
(isASAN && isLinux && process.arch === "x64" ? test.todo : test.skip).each([
  ["code that B3 generates", ["--aot-heat=everything-is-hot"]],
])(
  "AddressSanitizer reports a read behind the end of an object by %s",
  async (_, flags) => {
    using dir = tempDir("asan-red-zone-cells", { "entry.ts": shorterObject });
    for (const falseProof of [[], ["--aot-testing=ProveEverything"]]) {
      const executable = join(String(dir), falseProof.length ? "planted" : "sound");
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", ...falseProof, ...flags, "entry.ts", "--outfile", executable],
        String(dir),
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });

      const { stdout, stderr, exitCode } = await run([executable], String(dir), {
        ...bunEnv,
        ASAN_OPTIONS: bunEnv.ASAN_OPTIONS + ":symbolize=0",
      });
      if (!falseProof.length) {
        expect({ stdout, exitCode }).toEqual({ stdout: "32\n", exitCode: 0 });
        continue;
      }
      expect(stderr).toMatch(/poisoned memory: function \d+/);
      expect(stderr).toContain("AddressSanitizer: use-after-poison");
      expect(exitCode).not.toBe(0);
    }
  },
  240_000,
);

// A report names what touched the memory and the compiled frames below it, as an error's stack does.
const callers = `class Walker {
  total = 0;
  visit(outer: Outer): void {
    this.total += read(outer.a.r);
  }
}
function walk(list: Outer[]): number {
  const walker = new Walker();
  for (let i = 0; i < list.length; i++) walker.visit(list[i]);
  return walker.total;
}`;
const walked = (read: string) =>
  leaves(read + "\n" + callers).replace(
    "for (let i = 0; i < kept.length; i++) sum += read(kept[i].a.r);",
    "sum = walk(kept);",
  );
const at = (name: string) => String.raw`    at ${name} \(\S*entry\.ts:\d+:\d+\)\n`;

// The pinned engine does not print the names yet.
(isASAN && isLinux && process.arch === "x64" ? test.todo : test.skip).each([
  [
    "code that B3 generates",
    typedRead,
    ["--aot-heat=everything-is-hot"],
    new RegExp(
      String.raw`function \d+, at \d+ bytes into the code of the image\n` +
        at("visit") +
        at("walk") +
        String.raw`    at \S*entry\.ts:\d+:\d+\n=`,
    ),
  ],
  [
    "a stub",
    looseEquality,
    ["--aot-heat=everything-is-hot"],
    new RegExp(
      String.raw`a stub LooseEquals\w*, at \d+ bytes into the code of the image\n` +
        at("same") +
        at("read") +
        at("visit") +
        at("walk") +
        String.raw`    at \S*entry\.ts:\d+:\d+\n=`,
    ),
  ],
] as [string, string, string[], RegExp][])(
  "A report of AddressSanitizer names the compiled frames for %s",
  async (_, read, flags, report) => {
    using dir = tempDir("asan-names", { "entry.ts": walked(read) });
    const executable = join(String(dir), "sabotaged");
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...staleCells, ...flags, "entry.ts", "--outfile", executable],
      String(dir),
    );
    expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stderr } = await run([executable], String(dir), {
      ...bunEnv,
      ASAN_OPTIONS: bunEnv.ASAN_OPTIONS + ":symbolize=0",
    });
    expect(stderr).toMatch(report);
  },
  240_000,
);
