import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

const counter = (name: string) =>
  `globalThis.${name} = (globalThis.${name} ?? 0) + 1;\nmodule.exports = { load: globalThis.${name} };`;

// In each of these both calls of require() stand where every run of the body of their file passes them: not in a function, not under a try.
const files = {
  "deleted/counter.cjs": counter("deleted"),
  "deleted/one.test.js": `
    import { test } from "bun:test";
    const first = require("./counter.cjs");
    delete require.cache[require.resolve("./counter.cjs")];
    const second = require("./counter.cjs");
    test("deleted", () => { console.log("deleted:", first.load, second.load, first === second); });`,

  "stored/counter.cjs": counter("stored"),
  "stored/one.test.js": `
    import { test } from "bun:test";
    const first = require("./counter.cjs");
    require.cache[require.resolve("./counter.cjs")] = undefined;
    const second = require("./counter.cjs");
    test("stored", () => { console.log("stored:", first.load, second.load, first === second); });`,

  "often/counter.cjs": counter("often"),
  "often/one.test.js": `
    import { test } from "bun:test";
    const first = require("./counter.cjs");
    delete require.cache[require.resolve("./counter.cjs")];
    const second = require("./counter.cjs");
    const third = require("./counter.cjs");
    delete require.cache[require.resolve("./counter.cjs")];
    const fourth = require("./counter.cjs");
    test("often", () => { console.log("often:", first.load, second.load, third.load, fourth.load, second === third); });`,

  "helper/counter.cjs": counter("helper"),
  "helper/twice.cjs": `
    const first = require("./counter.cjs");
    delete require.cache[require.resolve("./counter.cjs")];
    const second = require("./counter.cjs");
    module.exports = [first.load, second.load];`,
  "helper/one.test.js": `
    import { test } from "bun:test";
    const loads = require("./twice.cjs");
    test("helper", () => { console.log("helper:", ...loads); });`,

  "below/counter.cjs": counter("below"),
  "below/asks.cjs": `module.exports = { load: require("./counter.cjs").load };`,
  "below/one.test.js": `
    import { test } from "bun:test";
    const first = require("./asks.cjs");
    delete require.cache[require.resolve("./asks.cjs")];
    delete require.cache[require.resolve("./counter.cjs")];
    const second = require("./asks.cjs");
    test("below", () => { console.log("below:", first.load, second.load); });`,

  "kept/counter.cjs": counter("kept"),
  "kept/one.test.js": `
    import { test } from "bun:test";
    const first = require("./counter.cjs");
    const second = require("./counter.cjs");
    delete require.cache[require.resolve("./counter.cjs")];
    test("kept", () => { console.log("kept:", first.load, second.load, first === second, require("./counter.cjs").load); });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

for (const [way, env] of ways) {
  test(way, async () => {
    using dir = tempDir("two-requires-of-one-body", files);
    const said = async (flags: string[], env: Record<string, string>) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
      if (exitCode !== 0) console.error(stderr);
      return { stdout, exitCode };
    };
    const plain = await said([], {});
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("deleted: 1 2 false");
    expect(plain.stdout).toContain("often: 1 2 2 3 true");
    expect(await said(["--aot"], env)).toEqual(plain);
  });
}
