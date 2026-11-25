// `bun build --compile --aot --external left-out`: first.cjs queues a job while it is loaded, so the loader walks the compiled cycle a > b > c > a record by record.
// c imports the package, which the loader reads from disk: a record that is not compiled below compiled ones. Each case prints what `bun <the main file>` prints in the same folder.
// (The package cannot import a file of the program in turn: an executable refuses that.)
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const ran = (name: string) => `(globalThis.order ??= []).push("${name}");\n`;
const program = {
  "main.mjs": `console.log((await import("./reads.mjs")).seen());\nconsole.log(String(globalThis.order));\n`,
  "reads.mjs": `import "./first.cjs";\nimport { a } from "./a.mjs";\nimport { b } from "./b.mjs";\n${ran("reads")}export const seen = () => a() + b();\n`,
  "first.cjs": `queueMicrotask(() => {});\nexports.x = 1;\n`,
  "a.mjs": `import { b } from "./b.mjs";\n${ran("a")}export const a = () => "a" + typeof b;\n`,
  "b.mjs": `import { c } from "./c.mjs";\n${ran("b")}export const b = () => "b" + c();\n`,
  "c.mjs": `import { a } from "./a.mjs";\nimport { outside } from "left-out";\n${ran("c")}export const c = () => "c" + typeof a + outside();\n`,
  "node_modules/left-out/package.json": `{ "name": "left-out", "type": "module", "main": "index.js" }\n`,
  "node_modules/left-out/deeper.js": `${ran("deeper")}export const deeper = () => "deeper";\n`,
};

const cases: Record<string, { index: string; prints: string }> = {
  "the package imports a file of its own": {
    index: `import { deeper } from "./deeper.js";\n${ran("outside")}export const outside = () => "outside " + deeper();\n`,
    prints: "afunctionbcfunctionoutside deeper\ndeeper,outside,c,b,a,reads\n",
  },
  "the package awaits at its top level": {
    index: `import { deeper } from "./deeper.js";\n${ran("outside<")}await 0;\n${ran("outside>")}export const outside = () => "outside " + deeper();\n`,
    prints: "afunctionbcfunctionoutside deeper\ndeeper,outside<,outside>,c,b,a,reads\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { index, prints } = cases[name];
  using dir = tempDir("aot-a-package-left-out-below-a-cycle", { ...program, "node_modules/left-out/index.js": index });
  const directory = String(dir);
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--external", "left-out", "main.mjs", "--outfile", executable],
    directory,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
