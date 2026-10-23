import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The sabotage keeps the collector from visiting `a.r`, so the leaves are dead, and poisoned, after the collection.
const leaves = (read: string) => `import { fullGC } from "bun:jsc";
interface Leaf { v: number; w: number }
interface Inner { r: Leaf; n: number }
interface Outer { a: Inner; id: number }
const kept: Outer[] = [];
function make(i: number): Outer { return { a: { r: { v: i, w: -i }, n: i }, id: i }; }
${read}
for (let i = 0; i < 4000; i++) kept.push(make(i));
fullGC();
let sum = 0;
for (let i = 0; i < kept.length; i++) sum += read(kept[i].a.r);
console.log(sum);
`;
const staleCells = ["--aot-sabotage=RoomIsNotInReferenceList", "--aot-testing=FlattenUntilHeldWhereverLegal"];
const typedRead = "function read(leaf: Leaf): number { return leaf.v; }";
const looseEquality = `function same(x: any, y: any): boolean { return x == y; }
const mixed: any[] = [{ v: 1 }, 1, "s", function () {}, undefined, null];
let warm = 0;
for (const m of mixed) for (const n of mixed) warm += same(m, n) ? 1 : 0;
function read(leaf: any): number { return same(leaf, "x") ? 1 : 2; }`;

const rows: [string, string, string, string[], RegExp, boolean][] = [
  [
    "code that B3 generates",
    typedRead,
    "7998000\n",
    ["--aot-heat=everything-is-hot"],
    /poisoned memory: function \d+/,
    false,
  ],
  [
    "code that is generated directly",
    typedRead,
    "7998000\n",
    ["--aot-testing=GenerateAllCodeDirectly"],
    /poisoned memory: function \d+/,
    true,
  ],
  ["a stub", looseEquality, "8000\n", ["--aot-heat=everything-is-hot"], /poisoned memory: a stub/, false],
];

test.skipIf(!isASAN || !isLinux || process.arch !== "x64").each(rows)(
  "AddressSanitizer reports a read of a dead cell by %s",
  async (_, read, expected, flags, report, isGeneratedDirectly) => {
    using dir = tempDir("asan-compiled-code", { "entry.ts": leaves(read) });
    for (const sabotage of [[], staleCells.slice(0, 1)]) {
      const executable = join(String(dir), sabotage.length ? "sabotaged" : "sound");
      const build = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...staleCells.slice(1),
          ...sabotage,
          ...flags,
          "--explain=statistics",
          "entry.ts",
          "--outfile",
          executable,
        ],
        String(dir),
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const generatedDirectly = Number(/FunctionsGeneratedDirectly (\d+)/.exec(build.stderr + build.stdout)?.[1] ?? 0);
      expect(generatedDirectly > 0).toBe(isGeneratedDirectly);

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
