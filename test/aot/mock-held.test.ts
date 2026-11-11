import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const modules: Record<string, { name: string; files: Record<string, string> }> = {
  "an ES module": { name: "./dep.js", files: { "dep.js": `export const who = "real";\n` } },
  "a CommonJS file": { name: "./dep.cjs", files: { "dep.cjs": `exports.who = "real";\n` } },
  "a package": {
    name: "pkg",
    files: {
      "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
      "node_modules/pkg/index.js": `export const who = "real";\n`,
    },
  },
};
const events: Record<string, (name: string) => string> = {
  "a second vi.doMock()": name => `vi.doMock("${name}", () => ({ who: "two" }));`,
  "vi.doUnmock()": name => `vi.doUnmock("${name}");`,
};
const after: Record<string, string> = { "a second vi.doMock()": "two", "vi.doUnmock()": "real" };

// Whoever was linked while a mock stood keeps that mock when it has ended or another has come, as whoever holds a module of `bun test` does.
// TODO(bun): `bun test` loads the importer anew where it is imported again: another object, and the one that was held goes on reading the first mock.
// Compiled code has one instance: from its second import on it reads what stands.
for (const [kind, { name, files }] of Object.entries(modules)) {
  for (const [event, call] of Object.entries(events)) {
    for (const isHoisted of [false, true]) {
      test(`${kind}, ${event}, the first mock ${isHoisted ? "hoisted" : "in the test"}`, async () => {
        const first = `("${name}", () => ({ who: "one" }));`;
        using dir = tempDir("aot-mock-held", {
          "package.json": `{ "type": "module" }`,
          ...files,
          "held.js": `import { who } from "${name}";
import * as ns from "${name}";
export const read = () => who + " " + ns.who;
`,
          "a.test.js": `import { test, vi } from "bun:test";
${isHoisted ? `vi.mock${first}\nimport * as held from "./held.js";` : ""}
const say = (...all) => console.log("seen:", ...all);
test("t", async () => {
${isHoisted ? "" : `  vi.doMock${first}\n  const held = await import("./held.js");`}
  say(held.read());
  ${call(name)}
  say(held.read());
  say((await import("${name}")).who);
  say(held.read());
  say((await import("./held.js")).read());
});
`,
        });
        const seenWith = async (words: string, ...more: string[]) => {
          const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more], String(dir), {
            ...bunEnv,
            BUN_DEBUG_TEST_AOT_WORDS: words,
          });
          return {
            lines: stdout
              .split("\n")
              .filter(line => line.startsWith("seen: "))
              .map(line => line.slice("seen: ".length)),
            failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error: /.test(line)),
            exitCode,
          };
        };
        const [plain, compiled] = await Promise.all([
          seenWith("TestRunLayers:0"),
          seenWith("TestRunLayers:0", "--aot"),
        ]);
        const now = after[event];
        expect(plain).toEqual({
          lines: ["one one", "one one", now, "one one", `${now} ${now}`],
          failed: [],
          exitCode: 0,
        });
        expect(compiled).toEqual(plain);
      }, 120_000);
    }
  }
}
