// asker.cjs runs because root.mjs imports it. While it runs it requires, by names that are made, root.mjs, the root of the graph that is being loaded, and then beside.mjs,
// which root.mjs imports and which imports root.mjs back. The loader runs the body of root.mjs ahead of the body of beside.mjs, inside the second require.
// Here both are found by name without a text of asker.cjs that the rest of the build goes by: every file is found (a test run that takes code from disk; an executable
// that takes code from disk and leaves a package out), or they are further entry points. asker.cjs is a file of the product: a ring of imports that a test enters is. Without
// the flag a test run finds for it what an executable built from the same files finds: a-load-written-in-the-product-finds-in-a-test-run-what-it-finds-in-the-executable.test.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const names: Record<string, (file: string) => string> = {
  "a written default": file => `process.env.MADE_UP_NONE || "./${file}.mjs"`,
  "a name that no text spells": file => `JSON.parse('"./${file}.mjs"')`,
};
const graph = (name: (file: string) => string) => ({
  "root.mjs": `import asker from "./asker.cjs";
import "./beside.mjs";
globalThis.said.push("root:" + Object.keys(asker).join(""));
export const value = 1;
`,
  "beside.mjs": `import "./root.mjs";
globalThis.said.push("beside");
export const value = 1;
`,
  "asker.cjs": `globalThis.said.push("asker<");
exports.a = 1;
globalThis.said.push("root:" + typeof require(${name("root")}));
globalThis.said.push("beside:" + typeof require(${name("beside")}));
exports.b = 2;
globalThis.said.push("asker>");
`,
});
const order = "asker< root:object root:a beside beside:object asker>";

async function expectExecutableToPrintAsBun(directory: string, flags: string[], entryPoints: string[], prints: string) {
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), entryPoints[0]], directory, bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const build = ["build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", executable];
  const built = await run([bunExe(), ...build], directory);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
}

describe.each(Object.entries(names))("%s", (_, name) => {
  test("in a test run", async () => {
    using dir = tempDir("aot-a-made-name-in-a-test-run", {
      ...graph(name),
      "package.json": `{ "name": "p" }`,
      "ring.test.cjs": `globalThis.said = [];
require("./root.mjs");
require("bun:test").test("the order of bodies", () => { console.log("the order: " + globalThis.said.join(" ")); });
`,
    });
    for (const flags of [[], ["--aot", "--aot-allow-code-from-disk"]]) {
      const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./ring.test.cjs"], String(dir), bunEnv);
      expect({ flags, lines: stdout.split("\n").filter(line => line.startsWith("the order")), exitCode }).toEqual({
        flags,
        lines: ["the order: " + order],
        exitCode: 0,
      });
    }
  });

  test("in an executable that takes code from disk and leaves a package out", async () => {
    using dir = tempDir("aot-a-made-name-beside-code-from-disk", {
      ...graph(name),
      "main.cjs": `globalThis.said = [];
require("left-out");
require("./root.mjs");
console.log(globalThis.said.join(" "));
`,
      "node_modules/left-out/index.js": `globalThis.said.push("left-out");
`,
    });
    const flags = ["--aot-allow-code-from-disk", "--external", "left-out"];
    await expectExecutableToPrintAsBun(String(dir), flags, ["main.cjs"], "left-out " + order + "\n");
  });

  test("in an executable with both as further entry points", async () => {
    using dir = tempDir("aot-a-made-name-finds-an-entry-point", {
      ...graph(name),
      "main.cjs": `globalThis.said = [];
require("./root.mjs");
console.log(globalThis.said.join(" "));
`,
    });
    await expectExecutableToPrintAsBun(String(dir), [], ["main.cjs", "root.mjs", "beside.mjs"], order + "\n");
  });
});
