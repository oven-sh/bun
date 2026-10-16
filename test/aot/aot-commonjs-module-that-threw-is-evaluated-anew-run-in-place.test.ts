import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A CommonJS module that throws while it loads is evaluated anew by the next `require()`. What the failed evaluation left behind, in a
// registry, in a listener, in the exports another module saw through a cycle, belongs to that evaluation: its functions, its classes and
// its variables are not those of the next one. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib/registers.cjs": `const kept = (globalThis.kept ??= []);
let counter = kept.length * 10 + 10;
function f() { return counter; }
class K { static n = kept.length + 1; }
kept.push({ f, K, bump: () => ++counter, read: () => counter, list: [], object: {} });
if (kept.length < 3) throw new Error("load " + kept.length);
module.exports = { f, K, loads: kept.length };
`,
  "lib/in-a-block.cjs": `globalThis.tries = (globalThis.tries ?? 0) + 1;
let n = 0;
(globalThis.bumps ??= []).push(() => ++n);
try { if (globalThis.tries === 1) { throw new RangeError("the first time"); } } catch (error) { throw error; }
exports.tries = globalThis.tries;
`,
  "lib/dependency.cjs": `exports.loads = globalThis.dependencyLoads = (globalThis.dependencyLoads ?? 0) + 1;`,
  "lib/with-a-dependency.cjs": `const dependency = require("./dependency.cjs");
globalThis.attempts = (globalThis.attempts ?? 0) + 1;
if (globalThis.attempts === 1) throw new Error("not yet");
module.exports = { dependency, attempts: globalThis.attempts, told: [__filename.split("/").pop(), module.id === __filename, require.cache[__filename] === module] };
`,
};

const attempt = `const attempt = load => { try { return load(); } catch (error) { return error.name + ": " + error.message; } };\n`;
const report = `const kept = globalThis.kept;
console.log(results[0], "|", results[1], "|", results[2].loads);
console.log(kept[0].f === kept[1].f, kept[0].K === kept[2].K, kept.map(it => it.K.n).join(), kept.map(it => it.read()).join());
console.log(kept[0].bump(), kept[2].bump(), kept.map(it => it.read()).join(), kept.map(it => it.f()).join());
console.log(results[2].f === kept[2].f, results[2].K === kept[2].K, require("./lib/registers.cjs") === results[2], kept.length);
`;

const programs: Record<string, string> = {
  "what-a-failed-load-left-behind.cjs": `${attempt}const load = () => require("./lib/registers.cjs");
const results = [attempt(load), attempt(load), attempt(load)];
${report}`,
  "asked-by-a-computed-name.cjs": `${attempt}const load = name => () => require(name);
const results = [attempt(load("./lib/registers.cjs")), attempt(load("./lib/registers.cjs")), attempt(load("./lib/registers.cjs"))];
${report}`,
  "thrown-in-a-block.cjs": `${attempt}const load = () => require("./lib/in-a-block.cjs");
console.log(attempt(load), JSON.stringify(attempt(load)));
console.log(globalThis.bumps[0](), globalThis.bumps[0](), globalThis.bumps[1]());
`,
  "what-it-required-stays.cjs": `${attempt}const load = () => require("./lib/with-a-dependency.cjs");
console.log(attempt(load), JSON.stringify(attempt(load)), globalThis.dependencyLoads);
`,
  "from-an-es-module.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
${attempt}const load = () => require("./lib/registers.cjs");
const results = [attempt(load), attempt(load), attempt(load)];
console.log(results[0], results[2].loads, globalThis.kept[0].f === globalThis.kept[2].f, globalThis.kept.map(it => it.read()).join());
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("threw-and-is-evaluated-anew", { ...files, [entry]: programs[entry] });
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

// Known differences, which the guide states (docs/bundler/aot-debugging.mdx): a load that fails inside a call, or because a module it
// requires fails, is evaluated again over the same top-level variables. These tests fail as long as that holds.
const knownDifferences: Record<string, Record<string, string>> = {
  "it-failed-inside-a-call.cjs": {
    "lib/fails-in-a-call.cjs": `let own = 0;
(globalThis.owners ??= []).push(() => ++own);
function check() { if (globalThis.owners.length < 2) throw new Error("not yet"); }
check();
exports.ready = true;
`,
    "it-failed-inside-a-call.cjs": `${attempt}const load = () => require("./lib/fails-in-a-call.cjs");
console.log(attempt(load), JSON.stringify(attempt(load)));
console.log(globalThis.owners[0](), globalThis.owners[0](), globalThis.owners[1]());
`,
  },
  "a-module-it-requires-failed.cjs": {
    "lib/over.cjs": `let own = 0;
(globalThis.owners ??= []).push(() => ++own);
exports.under = require("./under.cjs");
`,
    "lib/under.cjs": `if (globalThis.owners.length < 2) throw new Error("under is not ready");
exports.ready = true;
`,
    "a-module-it-requires-failed.cjs": `${attempt}const load = () => require("./lib/over.cjs");
console.log(attempt(load), JSON.stringify(attempt(load)));
console.log(globalThis.owners[0](), globalThis.owners[0](), globalThis.owners[1]());
`,
  },
};

describe.concurrent.each(Object.keys(knownDifferences))("known difference: %s", entry => {
  test.failing("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("threw-and-shares-its-variables", knownDifferences[entry]);
    const run = async (flags: string[]) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode };
    };
    expect(await run(["--aot"])).toEqual(await run([]));
  });
});
