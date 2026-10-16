import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `import()` of a CommonJS file goes by `require.cache` as `require()` does: after the file was deleted from the cache it yields the
// instance that was loaded since, or loads one. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib.cjs": `globalThis.turn = (globalThis.turn ?? 0) + 1; exports.turn = globalThis.turn; exports.named = "n" + globalThis.turn;`,
};

const programs: Record<string, string> = {
  "required-again-and-then-imported.mjs": `import lib, { named } from "./lib.cjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(lib.turn, named, require("./lib.cjs") === lib);
delete require.cache[require.resolve("./lib.cjs")];
const second = require("./lib.cjs");
console.log(second.turn, second.named, lib.turn, named, second === lib);
const third = await import("./lib.cjs");
console.log(third.default.turn, third.named, third.default === second, third.default === lib);
`,
  "imported-again-at-once.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const first = await import("./lib.cjs");
delete require.cache[require.resolve("./lib.cjs")];
const second = await import("./lib.cjs");
console.log(first.default.turn, second.default.turn, first === second, first.default === second.default, globalThis.turn);
`,
  "from-commonjs.cjs": `const first = require("./lib.cjs");
delete require.cache[require.resolve("./lib.cjs")];
import("./lib.cjs").then(second => console.log(first.turn, second.default.turn, second.default === first, require("./lib.cjs") === second.default));
`,
  "nothing-is-deleted.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const first = await import("./lib.cjs"), second = await import("./lib.cjs");
if (process.argv.length > 9) delete require.cache[require.resolve("./lib.cjs")];
console.log(first === second, first.default === require("./lib.cjs"), globalThis.turn);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("imported-after-it-left-the-cache", { ...files, [entry]: programs[entry] });
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
