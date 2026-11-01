// A hoisted `vi.mock("node:fs", ..)` comes ahead of the load, and a test ends it itself: `vi.doUnmock("node:fs")`. Whoever was linked against the mock goes on reading it
// until the test file ends; a require(), or a file that is loaded from then on, gets the module. A compiled run gave the module to everybody at once.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const head = `import { test, vi } from "bun:test";
import { seen } from "./src/uses.js";
vi.mock("node:fs", () => ({ default: { existsSync: () => "mocked" }, existsSync: () => "mocked" }));
`;
const forms = {
  "the reader goes on": `test("a", () => { console.log("OUT a", seen()); vi.doUnmock("node:fs"); console.log("OUT a behind", seen()); });
test("a2", () => console.log("OUT a2", seen()));`,
  "ended twice": `test("a", () => { console.log("OUT a", seen()); vi.doUnmock("node:fs"); vi.doUnmock("node:fs"); console.log("OUT a behind", seen()); });`,
  "a second mock waits for a load": `test("a", () => { console.log("OUT a", seen()); vi.doUnmock("node:fs"); vi.doMock("node:fs", () => ({ default: { existsSync: () => "second" }, existsSync: () => "second" })); console.log("OUT a behind", seen()); });
test("a2", () => console.log("OUT a2", seen()));`,
  "a require gets the module": `test("a", () => { console.log("OUT a", seen()); vi.doUnmock("node:fs"); console.log("OUT a require", require("node:fs").existsSync("/nowhere")); });`,
  "a new importer gets the module": `test("a", async () => { console.log("OUT a", seen()); vi.doUnmock("node:fs"); const { other } = await import("./src/other.js"); console.log("OUT a other", other()); });`,
};

const filesFor = (form: string) => ({
  "package.json": `{ "name": "mock-builtin-unmock", "type": "module" }`,
  "src/uses.js": `import it from "node:fs";
import * as all from "node:fs";
import { existsSync } from "node:fs";
export const seen = () => [it.existsSync("/nowhere"), all.existsSync("/nowhere"), existsSync("/nowhere"), Object.keys(all).length > 5].join();`,
  "src/other.js": `import { existsSync } from "node:fs";
export const other = () => String(existsSync("/nowhere"));`,
  "a.test.js": head + form,
  "b.test.js": `import { test } from "bun:test";
import { seen } from "./src/uses.js";
test("b", () => console.log("OUT b", seen()));`,
});

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, , exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, form) => {
    using folder = tempDir("aot-mock-builtin-unmock", filesFor(form));
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines[0]).toBe("OUT a mocked,mocked,mocked,false");
    expect(plain.lines.at(-1)).toBe("OUT b false,false,false,true");
    expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  },
  240_000,
);
