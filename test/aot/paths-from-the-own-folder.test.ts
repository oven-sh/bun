import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `require(__dirname + "/lib/common.js")`, `require(join(__dirname, "lib", "common.js"))`: a name made of the file's own folder and
// written parts is known when the program is built, so an ahead-of-time build compiles the file like any other that is required.
// BUN_JSC_crashIfInterpreterIsUsed=1 crashes the compiled program if any of its files is interpreted instead.

const files = {
  "lib/common.js": `exports.lib = "the file ran"; globalThis.evaluations = (globalThis.evaluations || 0) + 1;`,
  "lib/other.js": `exports.lib = "the other file ran";`,
  "lib/worker.js": `require("node:worker_threads").parentPort.postMessage("the worker ran");`,
};

const programs: Record<string, string> = {
  "dirname-plus-a-string.cjs": `console.log(require(__dirname + "/lib/common.js").lib);
`,
  "dirname-plus-two-strings.cjs": `console.log(require(__dirname + "/lib" + "/common.js").lib);
`,
  "a-template.cjs": `console.log(require(\`\${__dirname}/lib/common.js\`).lib);
`,
  "join.cjs": `const { join } = require("node:path");
console.log(require(join(__dirname, "lib", "common.js")).lib);
`,
  "path-join.cjs": `const path = require("path");
console.log(require(path.join(__dirname, "lib/common.js")).lib);
`,
  "path-resolve-read-off-require.cjs": `console.log(require(require("path").resolve(__dirname, "lib", "common.js")).lib);
`,
  "imported-join.mjs": `import { join } from "node:path";
console.log(require(join(import.meta.dirname, "lib", "common.js")).lib, require(join(import.meta.dir, "lib", "other.js")).lib);
`,
  "namespace-import.mjs": `import * as path from "node:path";
console.log(require(path.join(__dirname, "lib", "common.js")).lib);
`,
  "up-and-down.cjs": `const { join } = require("path");
console.log(require(join(__dirname, "lib", "..", "lib", "common.js")).lib);
`,
  "require-resolve.cjs": `console.log(require(require.resolve("./lib/common.js")).lib);
`,
  "the-same-module.cjs": `const { join } = require("path");
console.log(require(join(__dirname, "lib", "common.js")) === require("./lib/common.js"), globalThis.evaluations);
`,
  "one-of-two.cjs": `console.log(require(process.argv.length > 99 ? __dirname + "/lib/other.js" : __dirname + "/lib/common.js").lib);
`,
};

const workers: Record<string, string> = {
  "worker-by-join.cjs": `const { Worker } = require("node:worker_threads"), { join } = require("node:path");
new Worker(join(__dirname, "lib", "worker.js")).on("message", said => console.log(said));
`,
  "worker-through-a-constant.cjs": `const { Worker } = require("node:worker_threads"), { join } = require("node:path");
const overrides = globalThis.overrides || {};
const file = overrides.worker || join(__dirname, "lib", "worker.js");
new Worker(file).on("message", said => console.log(said));
`,
};

// What looks the same and is not: these stay ordinary calls.
const lookalikes: Record<string, string> = {
  "a-join-of-its-own.cjs": `const join = (...parts) => parts[0] + "/lib/other.js";
console.log(require(join(__dirname, "lib", "common.js")).lib);
`,
  "a-join-under-another-name.mjs": `import { join as glue } from "node:path";
console.log(require(glue(import.meta.dirname, "lib", "common.js")).lib);
`,
  "a-parameter-named-dirname.cjs": `function load(__dirname) { return require(__dirname + "/common.js").lib; }
console.log(load(__dirname + "/lib"));
`,
  "a-file-that-appears-later.cjs": `require("node:fs").writeFileSync(__dirname + "/lib/late.js", "exports.lib = 'written at run time';");
console.log(require(__dirname + "/lib/late.js").lib);
`,
  "a-file-that-is-not-there.cjs": `try { require(__dirname + "/lib/missing.js"); } catch (error) { console.log(error.code); }
`,
};

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

describe.concurrent.each(Object.keys({ ...programs, ...workers }))("%s", entry => {
  const tree = { ...files, [entry]: programs[entry] ?? workers[entry] };

  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("paths-from-the-own-folder", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    const aot = await spawned([bunExe(), "run", "--aot", entry], String(dir), compiledOnly);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test.skipIf(entry in workers)("bun build --compile --aot interprets nothing and prints what bun run prints, away from its sources", async () => {
    using dir = tempDir("paths-from-the-own-folder", tree);
    using elsewhere = tempDir("paths-from-the-own-folder-elsewhere", {});
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    const built = await spawned([bunExe(), "build", "--compile", "--aot", entry, "--outfile", join(String(elsewhere), "program")], String(dir));
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const aot = await spawned([join(String(elsewhere), "program")], String(elsewhere), compiledOnly);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

describe.concurrent.each(Object.keys(lookalikes))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("paths-from-the-own-folder", { ...files, [entry]: lookalikes[entry] });
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    using again = tempDir("paths-from-the-own-folder", { ...files, [entry]: lookalikes[entry] });
    const aot = await spawned([bunExe(), "run", "--aot", entry], String(again));
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
