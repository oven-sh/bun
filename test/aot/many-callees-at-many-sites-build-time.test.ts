// The time of a build does not hang on how a program is cut into files, functions and classes.
//
// Two programs in which each of N call sites may enter each of N functions. On one thread, so that the time is the work.
//
//   one file of N modules   what a bundler makes of N CommonJS modules, each of which requires the one before it: N callbacks handed
//                           to one helper, which makes the object for the exports of them all
//   N classes, one name     N classes with a method `run`, one array that holds an instance of each, N functions that call `run`
//                           on any element
//
// Each has been the cube of N in one place: 117 seconds for 2,000 modules in one file, which took 3 seconds as 2,000 files.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;
const timeout = isSlowBuild ? 480_000 : 90_000;

function modulesInOneFile(count: number) {
  const lines = [`var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);`];
  lines.push(
    `var require_m0 = __commonJS((exports) => {\n  exports.c = 1;\n  exports.f = function (x) { return x + exports.c; };\n});`,
  );
  for (let index = 1; index < count; index++) {
    lines.push(
      `var require_m${index} = __commonJS((exports) => {\n  var a = require_m${index - 1}();\n  exports.c = a.c + 1;\n` +
        `  exports.f = function (x) { return (x & 1) ? a.f(x) + exports.c : exports.c; };\n});`,
    );
  }
  lines.push(`var last = require_m${count - 1}();\nconsole.log(last.c, last.f(2), last.f(1));`);
  return lines.join("\n") + "\n";
}

function classesWithOneMethodName(count: number) {
  const indices = Array.from({ length: count }, (_, index) => index);
  return [
    ...indices.map(index => `class C${index} { constructor() { this.v = ${index}; } run(x) { return x + this.v; } }`),
    `const all = [${indices.map(index => `new C${index}()`).join(", ")}];`,
    ...indices.map(index => `function g${index}(n, x) { return n.run(x) + ${index}; }`),
    `let sum = 0;\nfor (const n of all) {`,
    ...indices.map(index => `  sum = (sum + g${index}(n, 1)) | 0;`),
    `}\nconsole.log(sum);`,
  ].join("\n");
}

async function buildsAndPrints(source: string) {
  using dir = tempDir("aot-many-callees", { "main.js": source });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const {
    stdout: buildOutput,
    stderr: buildErrors,
    exitCode: buildExitCode,
  } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "--aot-threads=1", "./main.js", "--outfile", executable],
    String(dir),
  );
  expect({ output: buildExitCode ? buildOutput + buildErrors : "", exitCode: buildExitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  const { stdout, stderr, exitCode } = await runCommand([executable], String(dir));
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout.trim();
}

test(
  "build time is no cube of the number of modules that a bundler has put into one file",
  async () => {
    const count = isSlowBuild ? 300 : 2_000;
    // f(1) adds up c of every module, and the 1 that the first adds to its own.
    expect(await buildsAndPrints(modulesInOneFile(count))).toBe(`${count} ${count} ${(count * (count + 1)) / 2 + 1}`);
  },
  timeout,
);

test(
  "build time is no cube of the number of classes that have a method of one name",
  async () => {
    const count = isSlowBuild ? 200 : 1_000;
    // Each of count * count calls answers 1 + v + index.
    expect(await buildsAndPrints(classesWithOneMethodName(count))).toBe(
      String((count * count + count * count * (count - 1)) | 0),
    );
  },
  timeout,
);
