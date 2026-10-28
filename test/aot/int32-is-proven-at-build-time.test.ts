// `int32` of "bun" is a promise that the build proves. programs/typed-objects/int32-*.ts and programs/type-rules/int32-*.ts have every form;
// here: `bun check --aot` and `bun build --compile --aot` report the same errors at the same places, code that is not in the program is not
// reported, what a JavaScript caller passes is tested at run time, and without --aot the type is `number`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    allowImportingTsExtensions: true,
    types: [],
  },
});
const prelude = `import type { int32 } from "bun";\ndeclare const console: { log(...values: unknown[]): void };\n`;

async function run(dir: string, ...cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, dir, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

const codes = (text: string) =>
  text.split("\n").flatMap(line => (/^error: (TS1000\d\d)/.exec(line) ?? /: error (TS1000\d\d)/.exec(line))?.[1] ?? []);

async function checkAndBuild(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-int32", { "tsconfig.json": tsconfig, ...files });
  const checked = await run(String(dir), bunExe(), "check", "--aot", "--no-pretty", "main.ts");
  const outfile = join(String(dir), isWindows ? "app.exe" : "app");
  const built = await run(
    String(dir),
    bunExe(),
    "build",
    "--compile",
    "--aot",
    ...flags,
    "main.ts",
    "--outfile",
    outfile,
  );
  const ran = built.exitCode === 0 ? await run(String(dir), outfile) : undefined;
  const plain = await run(String(dir), bunExe(), "run", "main.ts");
  return { checked, built, ran, plain };
}

test("the check and the build report the same errors, with what was found and what to write", async () => {
  const { checked, built, plain } = await checkAndBuild({
    "main.ts": `${prelude}function add(a: int32, b: int32): int32 {
  return a + b;
}
function bump(count: int32): int32 {
  count++;
  return count;
}
console.log(add(1, 2), bump(0));
`,
  });
  expect(checked.stdout.split("\n").filter(line => line.includes("TS1000"))).toEqual([
    "main.ts(4,10): error TS100031: The return value of 'add' is declared 'int32', but 'a + b' might not be an int32: it can be anything from -4294967296 to 4294967294. Write '(a + b) | 0'.",
    "main.ts(7,3): error TS100031: Parameter 'count' of 'bump' is declared 'int32', but 'count++' might not be an int32: it can be anything from -2147483647 to 2147483648. Write 'count = (count + 1) | 0'.",
  ]);
  expect(checked.exitCode).toBe(1);
  expect({ codes: codes(built.stderr), exitCode: built.exitCode }).toEqual({
    codes: ["TS100031", "TS100031"],
    exitCode: 1,
  });
  expect(plain).toEqual({ stdout: "3 1\n", stderr: "", exitCode: 0 });
}, 120_000);

test("what is written as the message says builds, and runs as in plain Bun", async () => {
  const { checked, built, ran, plain } = await checkAndBuild({
    "main.ts": `${prelude}function add(a: int32, b: int32): int32 {
  return (a + b) | 0;
}
let count: int32 = 2147483647;
count = (count + 1) | 0;
console.log(add(2147483647, 1), add(-2147483648, -1), count);
`,
  });
  expect({ codes: codes(checked.stdout + built.stderr), checked: checked.exitCode, built: built.exitCode }).toEqual({
    codes: [],
    checked: 0,
    built: 0,
  });
  expect(ran).toEqual({ stdout: "-2147483648 2147483647 -2147483648\n", stderr: "", exitCode: 0 });
  expect(plain).toEqual(ran!);
}, 120_000);

test("a function that nothing calls is not in the program, so it does not stop the build", async () => {
  const { built, ran } = await checkAndBuild({
    "main.ts": `${prelude}function unused(n: number): int32 {
  return n;
}
console.log("built");
`,
  });
  expect({ codes: codes(built.stderr), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
  expect(ran?.stdout).toBe("built\n");
}, 120_000);

test("what a JavaScript file passes is tested at run time: the program builds, and runs as in plain Bun", async () => {
  const { built, ran, plain } = await checkAndBuild({
    "main.ts": `import "./caller.js";\n`,
    "typed.ts": `import type { int32 } from "bun";\nexport function half(n: int32): number {\n  return n / 2;\n}\n`,
    "caller.js": `import { half } from "./typed.ts";\nconst given = JSON.parse('[3, 3.5, "7", null, 3e10]');\nfor (const value of [...given, undefined, -0, { valueOf() { return 5; } }]) console.log(half(value));\nconsole.log(half(given[0] | 0));\n`,
  });
  expect({ codes: codes(built.stderr), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
  expect(plain).toEqual({ stdout: "1.5\n1.75\n3.5\n0\n15000000000\nNaN\n-0\n2.5\n1.5\n", stderr: "", exitCode: 0 });
  expect(ran).toEqual(plain);
}, 120_000);

test.todo("an argument in a JavaScript file that might not be an int32 is reported at build time, as TS100031");

test("an imported function and an imported class are followed across files", async () => {
  const { built } = await checkAndBuild({
    "main.ts": `${prelude}import { half as halved, Cursor } from "./typed.ts";
const given: number[] = JSON.parse("[3]");
console.log(halved(given[0]!), new Cursor(given[0]!), [1].map(halved));
`,
    "typed.ts": `import type { int32 } from "bun";\nexport function half(n: int32): number {\n  return n / 2;\n}\nexport class Cursor {\n  constructor(public line: int32) {}\n}\n`,
  });
  expect({ codes: codes(built.stderr).sort(), exitCode: built.exitCode }).toEqual({
    codes: ["TS100031", "TS100031"],
    exitCode: 1,
  });
}, 120_000);

test("a module object hands out the functions of its module as values", async () => {
  const typed = `import type { int32 } from "bun";\nexport function half(n: int32): number {\n  return n / 2;\n}\n`;
  const called = await checkAndBuild({
    "main.ts": `${prelude}import * as typed from "./typed.ts";\nconsole.log(typed.half(3));\n`,
    "typed.ts": typed,
  });
  expect({ codes: codes(called.built.stderr), exitCode: called.built.exitCode, stdout: called.ran?.stdout }).toEqual({
    codes: [],
    exitCode: 0,
    stdout: "1.5\n",
  });
  for (const main of [
    `import * as typed from "./typed.ts";\nconsole.log(Object.keys(typed));\n`,
    `console.log(Object.keys(await import("./typed.ts")));\n`,
  ]) {
    const { built, ran, plain } = await checkAndBuild({ "main.ts": prelude + main, "typed.ts": typed });
    expect({ codes: codes(built.stderr), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
    expect(ran).toEqual(plain);
  }
}, 120_000);
