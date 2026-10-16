import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `module.require("name")`, and `const nodeRequire = module && module.require; nodeRequire.call(module, "name")`, which libraries write
// to keep a bundler from following an optional dependency. The name is written in the program, so under `bun run --aot` the file is
// compiled with it: BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib/local.js": `exports.name = "local"; globalThis.evaluations = (globalThis.evaluations || 0) + 1;`,
  "node_modules/optional-thing/package.json": `{ "name": "optional-thing", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/optional-thing/index.js": `exports.thing = require("./inner.js").inner + " thing";`,
  "node_modules/optional-thing/inner.js": `exports.inner = "optional";`,
};

const programs: Record<string, string> = {
  "taken-as-a-value.cjs": `const nodeRequire = module && module.require;
console.log(nodeRequire.call(module, "optional-thing").thing, nodeRequire.call(module, "./lib/local.js").name);
`,
  "called-on-the-module.cjs": `console.log(module.require("./lib/local.js").name, module.require("optional-thing").thing, module.require("./lib/local.js") === require("./lib/local.js"), globalThis.evaluations);
`,
  "in-a-function.cjs": `let thing = null;
function load() { try { const nodeRequire = module && module.require; thing = nodeRequire.call(module, "optional-thing").thing; } catch {} return thing; }
console.log(globalThis.evaluations, load(), load());
`,
  "not-there.cjs": `try { module.require("not-there"); } catch (error) { console.log(error.code); }
try { module.require.call(module, "./lib/not-there.js"); } catch (error) { console.log(error.code); }
console.log(module.require("./lib/local.js").name);
`,
  "another-receiver.cjs": `const join = { call(receiver, text) { return typeof receiver + " " + text; } };
console.log(join.call(module, "./lib/local.js"), globalThis.evaluations);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("module-require", { ...files, [entry]: programs[entry] });
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
