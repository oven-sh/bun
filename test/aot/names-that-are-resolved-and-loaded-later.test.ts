import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `require.resolve("./dep.cjs")` and `import.meta.resolve("./lib.mjs")` only ask where a file is, but whoever asks mostly loads it
// next, by the path. Under `bun run --aot` a file whose name is written out there is compiled with the program, so that it is compiled
// code when it is loaded. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib/dep.cjs": `exports.name = "a CommonJS file";`,
  "lib/lib.mjs": `export const name = "an ES module";`,
  "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/a-package/index.js": `exports.name = "a package";`,
};

const programs: Record<string, string> = {
  "resolved-and-required.cjs": `const path = require.resolve("./lib/dep.cjs");
console.log(require(path).name, require(require.resolve("a-package")).name);
`,
  "resolved-and-imported.mjs": `const url = import.meta.resolve("./lib/lib.mjs");
console.log((await import(url)).name);
`,
  "resolved-at-once.mjs": `const path = import.meta.resolveSync("./lib/lib.mjs");
console.log((await import(path)).name);
`,
  "by-a-made-require.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const list = [require.resolve("./lib/dep.cjs"), require.resolve("a-package")];
console.log(list.map(path => require(path).name).join());
`,
  "with-options.cjs": `const path = require.resolve("a-package", { paths: [__dirname] });
console.log(require(path).name);
`,
  "not-there.cjs": `try { require.resolve("not-installed"); } catch (error) { console.log(error.code); }`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("resolved-and-loaded-later", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
