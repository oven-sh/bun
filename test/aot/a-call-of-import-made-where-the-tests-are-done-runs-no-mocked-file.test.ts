import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads the files for the call on another thread, and ends the run when the tests have ended. It gives two answers: nothing more is said, or, on a busy machine,
// the mocks are undone and the whole chain runs with the files themselves. A compiled run gives the first of them each time, and never runs the mocked file alone.
const forms = {
  "an ES module": ["yarn.mjs", `export const ply = "yarn";`, `{ ply: "mocked yarn" }`],
  "a CommonJS file": ["yarn.cjs", `exports.ply = "yarn";`, `{ ply: "mocked yarn" }`],
  "a factory that never settles": ["yarn.mjs", `export const ply = "yarn";`, `new Promise(() => {})`],
};

for (const [form, [yarn, exported, made]] of Object.entries(forms)) {
  test(`nobody awaits a call that leads to a mocked file: ${form}`, async () => {
    using dir = tempDir("aot-call-left-in-flight", {
      "package.json": `{ "name": "p", "type": "module" }`,
      [yarn]: `console.log("the yarn begins");\n${exported}\n`,
      "shuttle.mjs": `const { ply } = await import("./${yarn}");\nconsole.log("the shuttle begins", ply);\nexport const pass = "shuttle " + ply;\n`,
      "loom.mjs": `import { pass } from "./shuttle.mjs";\nconsole.log("the loom begins", pass);\nexport const cloth = "loom " + pass;\n`,
      "a.test.mjs": `import { test, vi } from "bun:test";
test("the loom is called for", () => {
  vi.doMock("./${yarn}", () => { console.log("the factory of the yarn"); return ${made}; });
  vi.doMock("./loom.mjs", async original => ({ ...(await original()), more: 1 }));
  import("./loom.mjs").then(it => console.log("the call has settled", it.cloth, it.more));
  console.log("the test runs");
});
`,
    });
    const { stdout, exitCode } = await run([bunExe(), "test", "--aot", "./a.test.mjs"], String(dir), bunEnv);
    expect({ lines: stdout.split("\n").filter(line => line.startsWith("the ")), exitCode }).toEqual({
      lines: ["the test runs"],
      exitCode: 0,
    });
  });
}
