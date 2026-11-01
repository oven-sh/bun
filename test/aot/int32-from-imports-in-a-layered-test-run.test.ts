import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

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

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof said>>;
async function said(flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: String(dir) };
  const ran = await run([bunExe(), "test", ...flags, "."], String(dir), env);
  return {
    errors: ran.stderr.split("\n").filter(line => line.startsWith("error")),
    lines: ran.stdout.split("\n").filter(line => line.startsWith("SAID")),
    summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
  };
}
beforeAll(async () => {
  dir = tempDir("aot-int32-from-imports", files);
  plain = await said([], "");
});
afterAll(() => dir?.[Symbol.dispose]());

test("what plain Bun says", () => {
  expect(plain).toMatchObject({ errors: [], summary: [" 1 pass", " 0 fail"] });
  expect(plain.lines.length).toBe(reads.length);
});

test.each(["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"])(
  "a test file stores what it imports in an int32, however the run is built: %s",
  async words => {
    expect(await said(["--aot"], words)).toEqual(plain);
  },
);
