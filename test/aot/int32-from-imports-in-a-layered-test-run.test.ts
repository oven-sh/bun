import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const reads: [name: string, expression: string][] = [
  ["constant", "count"],
  ["call", "next()"],
  ["field", "new Point().y"],
  ["method", "new Point().sum()"],
  ["property", "origin.x"],
  ["awaited", "await later()"],
  ["branch", "flag ? next() : 0"],
  ["halved", "Math.floor(next() / 2)"],
  ["enum key", "own[at][Axis.Y]"],
  ["const enum key", "own[at][Fixed.Y]"],
  ["constant key", "own[at][key]"],
  ["fraction", "half()"],
  ["text", "label()"],
];

const places = (name: string, expression: string) => `
{
  const said: unknown[] = [];
  let variable: int32 = ${expression};
  said.push(variable);
  ${expression.startsWith("await") ? "async " : ""}function returned()${expression.startsWith("await") ? "" : ": int32"} { return ${expression}; }
  said.push(await returned());
  class Holder { field: int32 = ${expression.startsWith("await") ? "variable" : expression}; method(): int32 { const held: int32 = this.field; return held; } }
  said.push(new Holder().field, new Holder().method());
  said.push(pass(${expression}));
  console.log("SAID", ${JSON.stringify(name)}, JSON.stringify(said));
}`;

const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "src/values.ts": `import type { int32 } from "bun";
export const count: int32 = 5;
export function next(): int32 { return 7; }
export async function later(): Promise<int32> { return 9; }
export class Point { x: int32 = 1; y: int32 = 2; sum(): int32 { return (this.x + this.y) | 0; } }
export const origin: { x: int32 } = { x: 4 };
export enum Axis { X = "x", Y = "y" }
export const enum Fixed { X = "x", Y = "y" }
export const key = "y";
export const half: () => int32 = (() => 0.5) as any;
export const label: () => int32 = (() => "seven") as any;
`,
  "reads.test.ts": `import type { int32 } from "bun";
import { test } from "bun:test";
import { Axis, Fixed, Point, count, half, key, label, later, next, origin } from "./src/values";
class Own { x: int32 = 1; y: int32 = 2; }
const own = [new Own(), new Own()];
const at = Date.now() > 0 ? 1 : 0;
const flag = Date.now() > 0;
function pass(value: int32) { return value; }
test("reads", async () => {${reads.map(([name, expression]) => places(name, expression)).join("")}
});
`,
};

test("a test file stores what it imports in an int32, however the run is built", async () => {
  using dir = tempDir("aot-int32-from-imports", files);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: String(dir) };
    const ran = await run([bunExe(), "test", ...flags, "."], String(dir), env);
    return {
      errors: ran.stderr.split("\n").filter(line => line.startsWith("error")),
      lines: ran.stdout.split("\n").filter(line => line.startsWith("SAID")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain).toMatchObject({ errors: [], summary: [" 1 pass", " 0 fail"] });
  expect(plain.lines.length).toBe(reads.length);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:1")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
