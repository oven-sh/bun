import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// docs/compiler/debugging.mdx shows `delete require.cache[require.resolve(..)]`. The file was compiled with the run, so loading it again brings in nothing that an
// executable wouldn't hold, whether the `import()` stands beside the tests, in the sources or in a package.
const lazy = `
  export const byImport = async () => (await import("./state.js")).born;
  export const byRequire = () => require("./state.js").born;`;
const state = (name: string) => `
  globalThis.${name} = (globalThis.${name} ?? 0) + 1;
  export const born = globalThis.${name};`;
const files = {
  "package.json": `{ "name": "product" }`,
  "src/lazy.js": lazy,
  "src/state.js": state("ofSources"),
  "node_modules/kept/package.json": `{ "name": "kept", "main": "lazy.js" }`,
  "node_modules/kept/lazy.js": lazy,
  "node_modules/kept/state.js": state("ofPackage"),
  "test/lazy.js": lazy,
  "test/state.js": state("ofTests"),
  "test/main.test.js": `
    import { test } from "bun:test";
    import * as sources from "../src/lazy.js";
    import * as kept from "kept";
    import * as beside from "./lazy.js";
    const said = async ask => { try { return await ask(); } catch (error) { return "THROWS " + error.message.split(": ")[1]; } };
    for (const [name, { byImport, byRequire }, path] of [
      ["the sources", sources, "../src/state.js"],
      ["a package", kept, "kept/state.js"],
      ["beside the tests", beside, "./state.js"],
    ])
      test(name, async () => {
        const answers = [await said(byImport)];
        delete require.cache[require.resolve(path)];
        answers.push(await said(byImport));
        delete require.cache[require.resolve(path)];
        answers.push(await said(byRequire));
        for (const key in require.cache) delete require.cache[key];
        answers.push(await said(byImport));
        console.log("SAID", name + ":", answers.join(" "));
      });`,
};
const expected = ["SAID the sources: 1 2 3 4", "SAID a package: 1 2 3 4", "SAID beside the tests: 1 2 3 4"];

test.concurrent.each([
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
])(
  "%s",
  async (_, flags, words) => {
    using directory = tempDir("aot-a-module-taken-out-of-the-cache", files);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), env);
    expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "))).toEqual(expected);
  },
  240_000,
);
