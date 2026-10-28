import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// `import.meta` says nothing about what kind of module a file is: without `import` and `export` it is CommonJS by the same signs as any
// other file, and has `module` and `exports`.

const programs: Record<string, string> = {
  "typeof.ts": `console.log(typeof module, typeof exports, typeof require, import.meta.main);`,
  "module-exports.ts": `module.exports = { a: 1 };
console.log(import.meta.main, JSON.stringify(module.exports));
`,
  "the-idiom.ts": `function main(): void { console.log("main runs", import.meta.main); }
if (require.main === module) main();
`,
  "typeof.js": `console.log(typeof module, typeof exports, typeof require, import.meta.main, this === exports);`,
  "paths.cjs": `console.log(import.meta.path === __filename, import.meta.dir === __dirname, module.filename === __filename, typeof import.meta.url);`,
  "required.js": `const lib = require("./lib/named.js");
console.log(JSON.stringify(lib), import.meta.main);
`,
  "only-import-meta.js": `console.log(typeof import.meta, import.meta.main);`,
  "beside-an-export.mjs": `export const a = 1;
console.log(typeof module, typeof exports, import.meta.main);
`,
};

// The programs that say nothing of paths, which an executable has others of.
const inExecutables = [
  "typeof.ts",
  "module-exports.ts",
  "the-idiom.ts",
  "typeof.js",
  "only-import-meta.js",
  "beside-an-export.mjs",
];

const files = {
  "lib/named.js": `exports.isMain = import.meta.main;
exports.name = import.meta.file;
exports.isModule = require.main === module;
`,
};

const run = async (cmd: string[], cwd: string) => {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("beside-import-meta", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir));
    const aot = await run([bunExe(), "run", "--debug-aot", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
  test.skipIf(!inExecutables.includes(entry))("bun build --compile --aot prints what bun run prints", async () => {
    using dir = tempDir("beside-import-meta-compiled", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir));
    const build = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], String(dir));
    expect(build.exitCode).toBe(0);
    const aot = await run([join(String(dir), "program")], String(dir));
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
