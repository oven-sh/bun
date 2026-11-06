import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const testFile = (helper: string) => `
import { test } from "bun:test";
import { read } from "./helpers/reader.js";
test("a spy", async () => {
  let said;
  try {
    const before = read();
    const copy = await import("./helpers/${helper}.js?again");
    const restore = await copy.spy(["hid", "den"].join(""));
    const under = read();
    restore();
    said = [before, under, read()];
  } catch (error) {
    said = error.name + ": " + String(error.message).slice(0, 60);
  }
  console.error("SEEN ${helper} | " + JSON.stringify(said));
});
`;

test("the spy of a file that is loaded under a query is applied as in plain bun test", async () => {
  using dir = tempDir("aot-spy-in-a-file-loaded-under-a-query", {
    "package.json": `{ "name": "spy-under-a-query", "type": "module" }`,
    "helpers/hidden.js": `export function sumOf(pair) { return pair.x + pair.y; }\nexport function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\n`,
    "helpers/reader.js": `import { sumOf, total } from "./hidden.js";\nexport const read = () => [sumOf({ x: 1, y: 2 }), total([1, 2, 3])];\n`,
    "helpers/named.js": `import { spyOn } from "bun:test";\nimport * as hidden from "./hidden.js";\nexport const spy = async () => { const made = spyOn(hidden, "total").mockImplementation(() => "spied"); return () => made.mockRestore(); };\n`,
    "helpers/computed.js": `import { spyOn } from "bun:test";\nexport const spy = async name => { const hidden = await import("./" + name + ".js"); const made = spyOn(hidden, "sumOf").mockImplementation(() => "spied"); return () => made.mockRestore(); };\n`,
    "named.test.js": testFile("named"),
    "computed.test.js": testFile("computed"),
  });
  const seenWith = async (words: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=2", ...flags],
      String(dir),
      {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      },
    );
    return {
      seen: (stdout + "\n" + stderr)
        .split("\n")
        .filter(line => line.startsWith("SEEN "))
        .sort(),
      exitCode,
    };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith("TestRunLayers:0"),
    seenWith("TestRunLayers:0", "--aot"),
    seenWith("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.seen).toEqual([`SEEN computed | [[3,6],["spied",6],[3,6]]`, `SEEN named | [[3,6],[3,"spied"],[3,6]]`]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 120_000);
