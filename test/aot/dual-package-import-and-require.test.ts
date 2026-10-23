import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// One file that both imports and requires a package whose "exports" give `import` and `require` a different file. Each gets its own.

const files = {
  "node_modules/two-copies/package.json": `{ "name": "two-copies", "version": "1.0.0", "main": "./i.cjs", "exports": { ".": { "import": "./i.mjs", "require": "./i.cjs" } } }`,
  "node_modules/two-copies/i.cjs": `exports.state = { count: 0, kind: "cjs" };
exports.inc = () => ++exports.state.count;
exports.K = class K {};
`,
  "node_modules/two-copies/i.mjs": `export const state = { count: 0, kind: "esm" };
export const inc = () => ++state.count;
export class K {}
`,
  "node_modules/wrapped/package.json": `{ "name": "wrapped", "version": "1.0.0", "main": "./index.cjs", "exports": { ".": { "types": "./index.d.ts", "import": "./wrapper.mjs", "require": "./index.cjs" } } }`,
  "node_modules/wrapped/index.d.ts": `export declare const state: { count: number };
export declare function inc(): number;
export declare const isWrapper: boolean;
declare const whole: { state: { count: number }; inc(): number; whole(): string };
export default whole;
`,
  "node_modules/wrapped/index.cjs": `exports.state = { count: 0 };
exports.inc = () => ++exports.state.count;
module.exports.whole = function whole() { return "whole"; };
`,
  "node_modules/wrapped/wrapper.mjs": `import cjs from "./index.cjs";
export const state = cjs.state;
export const inc = cjs.inc;
export const isWrapper = true;
export default cjs;
`,
  "node_modules/one-function/package.json": `{ "name": "one-function", "version": "1.0.0", "exports": { ".": { "import": "./f.mjs", "require": "./f.cjs" } } }`,
  "node_modules/one-function/f.cjs": `module.exports = function required() { return "required"; };`,
  "node_modules/one-function/f.mjs": `export default function imported() { return "imported"; }`,
};

const programs: Record<string, string> = {
  "import-and-require.mjs": `import { state, inc, K } from "two-copies";
const r = require("two-copies");
console.log(inc(), inc(), r.inc(), JSON.stringify(state), JSON.stringify(r.state), r.state === state, new r.K() instanceof K);
`,
  "require-and-dynamic-import.cjs": `const r = require("two-copies");
import("two-copies").then(m => console.log(m.inc(), m.inc(), r.inc(), JSON.stringify(m.state), JSON.stringify(r.state), new r.K() instanceof m.K));
`,
  "a-wrapper.mjs": `import whole, { state, inc, isWrapper } from "wrapped";
const r = require("wrapped");
console.log(r.state === state, r.inc(), inc(), state.count, isWrapper, r.isWrapper, whole === r, r.whole());
`,
  "in-typescript.ts": `import { state, inc } from "wrapped";
function load(): any { return require("wrapped"); }
console.log(inc(), load().inc(), state.count, load().state === state, load().isWrapper);
`,
  "a-function.mjs": `import imported from "one-function";
const required = require("one-function");
console.log(imported(), required(), require("one-function")(), imported.name, required.name);
`,
  "handed-on.cjs": `module.exports = require("one-function");
import("one-function").then(m => console.log(m.default(), module.exports(), typeof require("one-function")));
`,
  "a-made-require.mjs": `import { state, inc } from "wrapped";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const r = require2("wrapped");
console.log(r.state === state, r.inc(), inc(), state.count, r.isWrapper);
`,
  "a-made-require-of-two-copies.mjs": `import { state, inc } from "two-copies";
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
console.log(inc(), made("two-copies").inc(), made("two-copies").inc(), state.kind, state.count, made("two-copies").state.kind, made("two-copies").state.count);
`,
  "destructured.mjs": `import * as namespace from "two-copies";
const { state, inc } = require("two-copies");
console.log(inc(), namespace.inc(), namespace.inc(), state.kind, state.count, namespace.state.kind, namespace.state.count, Object.keys(namespace).join());
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  const run = async (cmd: string[], cwd: string, env: Record<string, string> = {}) => {
    const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, ...env });
    return { stdout, stderr, exitCode };
  };
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("dual-package", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir));
    const aot = await run([bunExe(), "run", "--debug-aot", entry], String(dir), {
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
  test("bun build --compile --aot prints what bun run prints", async () => {
    using dir = tempDir("dual-package-compiled", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir));
    const build = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], String(dir));
    expect({
      stderr: build.stderr
        .split("\n")
        .filter(line => line.startsWith("error"))
        .join("\n"),
      exitCode: build.exitCode,
    }).toEqual({ stderr: "", exitCode: 0 });
    const aot = await run([join(String(dir), "program")], String(dir));
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
