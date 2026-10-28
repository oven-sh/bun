// `--aot-testing=FailPredictions[:<n>[:<seed>]]`: one time in n, compiled code takes the general road behind a type test although the value would have passed. No answer may change.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run as spawned } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const program = `class Point {
  constructor(public x: number, public y: number, public label?: string) {}
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}
function total(points: Point[]): number {
  let sum = 0;
  for (const point of points) sum += point.norm();
  return sum;
}
function describePoint(point: Point, digits: number): string {
  return (point.label ?? "-") + point.x.toFixed(digits) + "," + point.y.toFixed(digits);
}
function untyped(value, times) {
  let out = value;
  for (let turn = 0; turn < times; turn++) out = out + value;
  return out;
}
const points: Point[] = [];
for (let index = 0; index < 300; index++) points.push(new Point(index, index + 1, index % 3 ? undefined : "p" + index));
const byLabel = new Map<string, Point>();
for (const point of points) if (point.label) byLabel.set(point.label, point);
console.log(total(points).toFixed(3), byLabel.size, describePoint(points[3], 1), describePoint(points[4], 2));
console.log(untyped(1, 5), untyped("a", 3), [...points.slice(0, 2)].map(point => JSON.stringify(point)).join());
const { x, ...rest } = points[6];
console.log(x, Object.keys(rest).join(), points.filter(point => point.x % 100 === 0).map(point => point.y).join());
async function later(value: number): Promise<number> {
  await null;
  return value * 2;
}
console.log((await Promise.all([1, 2, 3].map(later))).join());
`;
const printed = `63640.901 100 p33.0,4.0 -4.00,5.00
6 aaaa {"x":0,"y":1,"label":"p0"},{"x":1,"y":2}
6 y,label 1,101,201
2,4,6
`;

async function build(cwd: string, name: string, flags: string[]) {
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "program.ts", "--outfile", name],
    cwd,
  );
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return built;
}
const placesIn = (built: { stdout: string; stderr: string }) =>
  Number(/PlacesWherePredictionsFailUnasked (\d+)/.exec(built.stderr + built.stdout)?.[1] ?? 0);

describe.concurrent.each(["", ":2", ":2:1", ":2:2", ":7:1", ":100:1"])("--aot-testing=FailPredictions%s", numbers => {
  test("the program answers as in plain Bun", async () => {
    using folder = tempDir("aot-predictions-fail", { "program.ts": program });
    expect(
      placesIn(
        await build(String(folder), "failing", ["--aot-testing=FailPredictions" + numbers, "--explain=statistics"]),
      ),
    ).toBeGreaterThan(10);
    const { stdout, stderr, exitCode } = await spawned(
      withoutCoreDump([join(String(folder), "failing")]),
      String(folder),
    );
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  }, 120_000);
});

// Each program holds one kind of prediction and little else: more places with the line than without it.
const kinds = {
  "a text parsed by a type": [
    `type Pair = { left: number; right: { name: string; tags: string[] } };\nconst text = '{"left":1,"right":{"name":"n","tags":["a","b"]}}';\n`,
    `const pair = JSON.parse(text) as Pair;\nconsole.log(pair.left, pair.right.name, pair.right.tags.join());\n`,
    "1 n a,b\n",
  ],
  "an object of a declared type made a text": [
    `type Pair = { left: number; right: { name: string; tags: string[] } };\nconst make = (left: number): Pair => ({ left, right: { name: "n" + left, tags: ["a", "b"] } });\nconst pairs = [make(1), make(2)];\n`,
    `function textOf(pair: Pair): string {\n  return JSON.stringify(pair);\n}\nfor (const pair of pairs) console.log(textOf(pair));\n`,
    `{"left":1,"right":{"name":"n1","tags":["a","b"]}}\n{"left":2,"right":{"name":"n2","tags":["a","b"]}}\n`,
  ],
  "the result of an async function": [
    `const box = (value: number): { value: number } | Promise<{ value: number }> => (value % 2 ? { value } : Promise.resolve({ value }));\n`,
    `async function boxed(value: number) {\n  return box(value);\n}\nconsole.log((await boxed(1)).value, (await boxed(2)).value);\n`,
    "1 2\n",
  ],
  "an await of a number": [
    `const numbers = [1, 2, 3];\n`,
    `async function sum() {\n  let total = 0;\n  for (const number of numbers) total += await number;\n  return total;\n}\nconsole.log(await sum());\n`,
    "6\n",
  ],
};
describe.concurrent.each(Object.entries(kinds))("%s", (_, [head, line, answer]) => {
  test.each(["", ":2:1", ":2:2", ":3:1"])(
    "fails unasked with FailPredictions%s",
    async numbers => {
      using folder = tempDir("aot-predictions-fail", {
        "program.ts": head + line,
        "without.ts": head + "console.log(1);\n",
      });
      const cwd = String(folder);
      const flags = ["--aot-testing=FailPredictions" + numbers, "--explain=statistics"];
      const places = placesIn(await build(cwd, "failing", flags));
      const built = await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, "without.ts", "--outfile", "without"],
        cwd,
      );
      expect(built.exitCode).toBe(0);
      expect(places).toBeGreaterThan(placesIn(built));
      const { stdout, stderr, exitCode } = await spawned(withoutCoreDump([join(cwd, "failing")]), cwd);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: answer, stderr: "", exitCode: 0 });
    },
    120_000,
  );
});

test("without the switch there is no such place", async () => {
  using folder = tempDir("aot-predictions-fail", { "program.ts": program });
  expect(placesIn(await build(String(folder), "plain", ["--explain=statistics"]))).toBe(0);
}, 120_000);

test("a seed decides which predictions fail", async () => {
  using folder = tempDir("aot-predictions-fail", { "program.ts": program });
  const cwd = String(folder);
  const countsOf = async (name: string, file: string) => {
    const ran = await spawned(withoutCoreDump([join(cwd, name)]), cwd, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: join(cwd, file),
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
    return readFileSync(join(cwd, file), "utf8")
      .split("\n")
      .filter(line => line.includes("\tbranch:"))
      .sort()
      .join("\n");
  };
  await Promise.all(
    [1, 2].map(seed => build(cwd, "seed" + seed, ["--aot-count-branches", "--aot-testing=FailPredictions:3:" + seed])),
  );
  const first = await countsOf("seed1", "first");
  expect(first).not.toBe("");
  expect(await countsOf("seed1", "again")).toBe(first);
  expect(await countsOf("seed2", "other")).not.toBe(first);
}, 240_000);

test.each(["FailPredictions:0", "FailPredictions:x", "FailPredictions:2:70000", "IgnoreBranchHints:2"])(
  "--aot-testing=%s is refused",
  async word => {
    using folder = tempDir("aot-predictions-fail", { "program.ts": "console.log(1);\n" });
    const built = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-testing=" + word, "program.ts", "--outfile", "refused"],
      String(folder),
    );
    expect(built.exitCode).not.toBe(0);
  },
  60_000,
);
