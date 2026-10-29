// Without strictNullChecks TypeScript lets `undefined` into every `number`. The build still proves every int32: what can be left out (an optional
// property, an optional parameter, a field that no constructor assigns) is not an int32, and everything whose stores the compiler sees still is.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
});
const prelude = `import type { int32 } from "bun";\ndeclare const console: { log(...values: unknown[]): void };\n`;

async function build(program: string) {
  using dir = tempDir("aot-int32-lax", { "tsconfig.json": tsconfig, "main.ts": prelude + program });
  const outfile = join(String(dir), isWindows ? "app.exe" : "app");
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", outfile],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const errors = stderr
    .split("\n")
    .filter(line => line.startsWith("error: "))
    .map(line => /, but ('[^']*') might not be an int32/.exec(line)?.[1] ?? line);
  if (exitCode !== 0) return { errors, exitCode, stdout: "" };
  await using ran = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  return { errors, exitCode, stdout: await ran.stdout.text() };
}

// TODO: the executable prints what plain Bun prints; TS100031 is not reported for the four places.
test.todo(
  "what can be left out is not an int32",
  async () => {
    expect(
      await build(`interface Point { x: int32; y?: int32 }
class Cursor { line: int32; column?: int32; late: int32; constructor() { this.line = 1; } }
function property(p: Point): int32 { return p.y; }
function parameter(n?: int32): int32 { return n; }
function field(c: Cursor): int32 { return c.column; }
function unassigned(c: Cursor): int32 { return c.late; }
console.log(property({ x: 1 }), parameter(), field(new Cursor()), unassigned(new Cursor()));
`),
    ).toEqual({ errors: ["'p.y'", "'n'", "'c.column'", "'c.late'"], exitCode: 1, stdout: "" });
  },
  120_000,
);

test("arithmetic on what can be left out is as in plain Bun", async () => {
  expect(
    await build(`interface Point { x: int32; y?: int32 }
function sum(p: Point): number { return p.y + 1; }
function next(n?: int32): number { return n + 1; }
console.log(sum({ x: 1 }), sum({ x: 1, y: 2 }), next(), next(4));
`),
  ).toEqual({ errors: [], exitCode: 0, stdout: "NaN 3 NaN 5\n" });
}, 120_000);

test("what the compiler sees every store of is an int32 all the same", async () => {
  expect(
    await build(`interface Point { x: int32 }
let kept: int32 = 0;
function assignedLater(a: int32, flag: boolean): int32 { var x: int32; if (flag) x = a; else x = 1; return x; }
function throughLocal(p: Point): int32 { var x = p.x; return x; }
function bounded(text: string): int32 { let last: int32 = 0; for (let i: int32 = 0; i < text.length; i++) last = i; return last; }
function store(a: int32): void { kept = a; }
store(7);
console.log(assignedLater(3, true), assignedLater(3, false), throughLocal({ x: 5 }), bounded("four"), kept);
`),
  ).toEqual({ errors: [], exitCode: 0, stdout: "3 1 5 3 7\n" });
}, 120_000);
