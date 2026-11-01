import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// A CommonJS file is taken out of require.cache and loads a second time. Each require() answers the load that it started or that the cache held,
// and what was bound to the first load stays with it.
const files = {
  // The second load begins and ends while the first is still running.
  "cycle/parent.cjs": `
    globalThis.parents = (globalThis.parents ?? 0) + 1;
    exports.load = globalThis.parents;
    require("./child.cjs");`,
  "cycle/child.cjs": `
    delete require.cache[require.resolve("./parent.cjs")];
    exports.again = require("./parent.cjs").load;`,
  "cycle/one.test.js": `
    import { test } from "bun:test";
    test("cycle", () => {
      const outer = require("./parent.cjs");
      const later = require("./parent.cjs");
      console.log("cycle:", outer.load, require("./child.cjs").again, globalThis.parents, later.load, later === outer);
    });`,

  "imported/parent.cjs": `
    globalThis.imported = (globalThis.imported ?? 0) + 1;
    exports.load = globalThis.imported;
    require("./child.cjs");`,
  "imported/child.cjs": `
    delete require.cache[require.resolve("./parent.cjs")];
    exports.again = require("./parent.cjs").load;`,
  "imported/one.test.js": `
    import { test } from "bun:test";
    import outer from "./parent.cjs";
    test("imported", async () => {
      const later = require("./parent.cjs");
      console.log("imported:", outer.load, require("./child.cjs").again, globalThis.imported, later.load, later === outer);
    });`,

  // The first load stores its exports behind the second one.
  "late/parent.cjs": `
    globalThis.late = (globalThis.late ?? 0) + 1;
    const mine = globalThis.late;
    require("./child.cjs");
    module.exports = { load: mine };`,
  "late/child.cjs": `
    delete require.cache[require.resolve("./parent.cjs")];
    exports.again = require("./parent.cjs").load;`,
  "late/one.test.js": `
    import { test } from "bun:test";
    test("late", () => {
      const outer = require("./parent.cjs");
      const later = require("./parent.cjs");
      console.log("late:", outer.load, require("./child.cjs").again, globalThis.late, later.load, later === outer);
    });`,

  // An importer that was loaded under a name made at run time reads the names off the file.
  "made/state.cjs": `
    globalThis.states = (globalThis.states ?? 0) + 1;
    const me = "state#" + globalThis.states;
    let calls = 0;
    exports.bump = function () { return me + ":" + ++calls; };`,
  "made/importer.js": `
    import { bump } from "./state.cjs";
    export function viaImport() { return bump(); }`,
  "made/requirer.js": `export function viaRequire() { return require("./state.cjs").bump(); }`,
  "made/one.test.js": `
    import { test } from "bun:test";
    const made = name => { let text = ""; for (let i = 0; i < name.length; i++) text += name[i]; return text; };
    test("made", () => {
      const importer = require(made("./importer.js"));
      const requirer = require("./requirer.js");
      console.log("made:", importer.viaImport(), requirer.viaRequire());
      delete require.cache[require.resolve("./state.cjs")];
      console.log("made:", importer.viaImport(), requirer.viaRequire(), importer.viaImport(), requirer.viaRequire());
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

for (const [way, env] of ways) {
  test(way, async () => {
    using dir = tempDir("each-load-keeps-its-exports", files);
    const said = async (flags: string[], env: Record<string, string>) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), {
        ...bunEnv,
        ...env,
      });
      if (exitCode !== 0) console.error(stderr);
      return {
        lines: stdout
          .split("\n")
          .filter(line => /^[a-z]+: /.test(line))
          .sort(),
        exitCode,
      };
    };
    const plain = await said([], {});
    expect(plain.exitCode).toBe(0);
    expect(plain.lines).toContain("cycle: 1 2 2 2 false");
    expect(plain.lines).toContain("late: 1 2 2 2 false");
    expect(plain.lines).toContain("made: state#1:3 state#2:1 state#1:4 state#2:2");
    expect(await said(["--aot"], env)).toEqual(plain);
  });
}
