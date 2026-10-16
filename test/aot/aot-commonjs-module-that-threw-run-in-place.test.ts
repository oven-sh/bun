import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const twice = (file: string) => `
  Object.keys(require.cache);
  for (const time of [1, 2, 3]) {
    try { console.log("got:", JSON.stringify(require("./${file}")), Object.keys(require.cache).some(key => key.endsWith("${file}"))); }
    catch (error) { console.log("caught:", error.message, Object.keys(require.cache).some(key => key.endsWith("${file}"))); }
  }
`;
const begins = `globalThis.times = (globalThis.times || 0) + 1;\nconsole.log("begins, time", globalThis.times);\n`;
const files = {
  "replaces-exports.js": `${begins}module.exports = { a: 1 };\nthrow new Error("thrown at load");\n`,
  "adds-to-exports.js": `${begins}exports.a = 1;\nmodule.exports.b = () => 2;\nthrow new Error("thrown at load");\n`,
  "throws-twice.js": `${begins}exports.a = globalThis.times;\nif (globalThis.times < 3) throw new Error("thrown at load, time " + globalThis.times);\n`,
  "lacks-a-package.js": `"use strict";\nconst get = require("a-package-that-is-not-there");\nmodule.exports.sleep = () => get;\n`,
  "replaces-exports.cjs": twice("replaces-exports.js"),
  "adds-to-exports.cjs": twice("adds-to-exports.js"),
  "throws-twice.cjs": twice("throws-twice.js"),
  "lacks-a-package.cjs": twice("lacks-a-package.js"),
  "a.test.js": `const { test } = require("node:test");\ntest("reads require.cache", () => { const cache = require.cache; require.cache = undefined; require.cache = cache; });\n`,
  "b.test.js": `const { test } = require("node:test");\nconst helper = require("./lacks-a-package.js");\ntest("never runs", () => { helper.sleep(); });\n`,
  "c.test.js": `const { test } = require("node:test");\nconst helper = require("./lacks-a-package.js");\ntest("never runs either", () => { helper.sleep(); });\n`,
};
const compiledOnly = { BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(["replaces-exports.cjs", "adds-to-exports.cjs", "throws-twice.cjs", "lacks-a-package.cjs"])(
  "bun run --aot %s: a CommonJS module that threw is compiled code the next time too, once require.cache has been read",
  async entry => {
    using dir = tempDir("aot-module-that-threw", files);
    const plain = await run(String(dir), ["run", `./${entry}`]);
    const compiled = await run(String(dir), ["run", "--aot", `./${entry}`], compiledOnly);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout).toContain("caught: ");
  },
  120_000,
);

test.concurrent(
  "bun test --aot: two test files require a helper that throws, behind a file that reads require.cache",
  async () => {
    using dir = tempDir("aot-module-that-threw", files);
    const said = (text: string) => text.split("\n").filter(line => /^error: |^ *\d+ (pass|fail|error)/.test(line)).join("\n");
    const plain = await run(String(dir), ["test", "./a.test.js", "./b.test.js", "./c.test.js"]);
    const compiled = await run(String(dir), ["test", "--aot", "./a.test.js", "./b.test.js", "./c.test.js"], compiledOnly);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ said: said(compiled.stderr), exitCode: compiled.exitCode }).toEqual({ said: said(plain.stderr), exitCode: plain.exitCode });
    expect(said(plain.stderr)).toContain(" 1 pass");
  },
  120_000,
);
