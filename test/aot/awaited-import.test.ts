// `require()` runs a CommonJS file again whose last run threw, so the build compiles a file otherwise that may run again: that takes somebody who caught the throw.
// `await import("./a.cjs")` at the top of a file, with no handler around: nobody but the `await` holds the promise, and what the file throws goes on as it does from an import statement.
// Every file below such a load used to count as one that may run again: 32 of 100 functions of a server were compiled otherwise than under the statement.
// Where somebody does catch (a handler around it, the promise kept or handed on, a function that is called later) the files do run again, as under `bun run`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment, compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const again = `
globalThis.throws = false;
const { createRequire } = await import("node:module");
console.log("again:", createRequire(import.meta.url)("./lib/a.cjs").value, globalThis.ran.join());`;

const entries: [name: string, file: string, text: string, mayRunAgain: number][] = [
  [
    "an import statement",
    "main.mjs",
    `import { value } from "./lib/a.cjs"; console.log(value, globalThis.ran.join());`,
    0,
  ],
  [
    "awaited at once",
    "main.mjs",
    `const { value } = await import("./lib/a.cjs"); console.log(value, globalThis.ran.join());`,
    0,
  ],
  [
    "awaited at once through a type assertion",
    "main.ts",
    `const { value } = await (import("./lib/a.cjs") as Promise<{ value: number }>); console.log(value, (globalThis as any).ran.join());`,
    0,
  ],
  [
    "awaited at once, and it throws",
    "main.mjs",
    `globalThis.throws = true; console.log("begins"); await import("./lib/a.cjs"); console.log("not reached");`,
    0,
  ],
  [
    "awaited with a handler around it",
    "main.mjs",
    `globalThis.throws = true; try { await import("./lib/a.cjs"); } catch (error) { console.log("caught:", error.message); }${again}`,
    2,
  ],
  [
    "the promise has a handler of its own",
    "main.mjs",
    `globalThis.throws = true; await import("./lib/a.cjs").catch(error => console.log("caught:", error.message));${again}`,
    2,
  ],
  [
    "the promise is kept",
    "main.mjs",
    `globalThis.throws = true; const kept = import("./lib/a.cjs"); await kept.then(() => {}, error => console.log("caught:", error.message));${again}`,
    2,
  ],
  [
    "awaited in a function",
    "main.mjs",
    `globalThis.throws = true; const load = async () => (await import("./lib/a.cjs")).value; console.log(await load().catch(error => "caught: " + error.message));
globalThis.throws = false; console.log("again:", await load().catch(error => "caught: " + error.message), globalThis.ran.join());`,
    2,
  ],
];

for (const [name, file, text, mayRunAgain] of entries) {
  test.concurrent(`${name}: ${mayRunAgain} files may run again`, async () => {
    using dir = tempDir("awaited-import", {
      "package.json": `{}`,
      "lib/a.cjs": `(globalThis.ran ??= []).push("a"); exports.value = require("./b.cjs").value + 1;`,
      "lib/b.cjs": `(globalThis.ran ??= []).push("b"); if (globalThis.throws) throw new Error("thrown by b"); exports.value = 1;`,
      [file]: text,
    });
    const program = join(String(dir), isWindows ? "program.exe" : "program");
    const build = await run([bunExe(), ...compileCommand, `./${file}`, "--outfile", program], String(dir), {
      ...bunEnv,
      [buildEnvironment.logsPhaseTimes]: "1",
    });
    expect(build.exitCode).toBe(0);
    expect(/CommonJS files that may run again (\d+)/.exec(build.stderr)?.[1]).toBe(String(mayRunAgain));
    const [plain, compiled] = await Promise.all([
      run([bunExe(), `./${file}`], String(dir), bunEnv),
      run([program], String(dir), bunEnv),
    ]);
    expect(plain.stdout).not.toBe("");
    expect({
      stdout: compiled.stdout,
      exitCode: compiled.exitCode,
      says: compiled.stderr.includes("thrown by b"),
    }).toEqual({ stdout: plain.stdout, exitCode: plain.exitCode, says: plain.stderr.includes("thrown by b") });
  });
}
