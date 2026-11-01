import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `spyOn(await import("./m"), "notExported")`: plain Bun hands back a mock that stands nowhere: the object does not get the name, and the mock records nothing. So does a compiled run.
// But mockRestore() and mock.restore() put `undefined` "back" under the name, and a CommonJS file takes a name that it is handed:
// a module that was loaded later and said `import { notExported } from "./c.cjs"` linked, where plain throws a SyntaxError, and `export * from "./c.cjs"` showed the name.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/m.mjs": `export const value = 1;
export function exported() { return "real"; }
export const callExported = () => exported();
export const readValue = () => value;
`,
  "src/c.cjs": `exports.exported = () => "real"; exports.value = 1;
`,
  "src/late.mjs": `import { notExported } from "./c.cjs"; export const seen = typeof notExported;
`,
  "src/star.mjs": `import * as all from "./c.cjs"; export const keys = () => Object.keys(all).join(); export const has = name => name in all;
`,
  "src/barrel.mjs": `export * from "./c.cjs";
`,
  "body.mjs": `export async function run(spyOn, mock) {
  const tell = (name, ask) => { try { console.log(name + ":", ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).slice(0, 110)); } };
  for (const [kind, ns] of [["an ES module", await import("./src/m.mjs")], ["a CommonJS file", await import("./src/c.cjs")]]) {
    console.log("#", kind);
    let spy;
    tell("spyOn of a name that is not exported", () => { spy = spyOn(ns, "notExported"); return typeof spy; });
    tell("the name afterwards", () => [typeof ns.notExported, "notExported" in ns, Object.keys(ns).includes("notExported"), ns.notExported === spy].join());
    tell("called through the object", () => { const answer = ns.notExported?.(); return [String(answer), spy?.mock.calls.length].join(); });
    tell("a second spyOn gives the same", () => spyOn(ns, "notExported") === spy);
    tell("mockReturnValue", () => { spy?.mockReturnValue(7); return String(ns.notExported); });
    tell("mockRestore", () => { spy?.mockRestore(); return [typeof ns.notExported, "notExported" in ns, Object.keys(ns).join()].join(" "); });
    tell("a symbol", () => { const other = spyOn(ns, Symbol.for("absent")); const seen = typeof ns[Symbol.for("absent")]; other.mockRestore(); return [typeof other, seen].join(); });
    tell("an index", () => { const other = spyOn(ns, 0); const seen = typeof ns[0]; other.mockRestore(); return [typeof other, seen].join(); });
    tell("an exported function still works", () => { const other = spyOn(ns, "exported").mockReturnValue("mocked"); const seen = ns.exported(); other.mockRestore(); return [seen, ns.exported()].join(); });
    tell("restoreAll behind another", () => { spyOn(ns, "alsoAbsent"); mock.restore(); return [typeof ns.alsoAbsent, Object.keys(ns).join()].join(" "); });
  }
}
`,
  "a.test.mjs": `import { test, spyOn, mock } from "bun:test";
import { run } from "./body.mjs";
test("t", async () => { await run(spyOn, mock); });
`,
  "b.test.mjs": `import { test, spyOn, mock } from "bun:test";
const tell = (name, ask) => { try { console.log(name + ":", ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).slice(0, 110)); } };
test("a CommonJS file that some test mocks", async () => {
  const ns = await import("./src/c.cjs");
  const shown = () => [typeof ns.notExported, "notExported" in ns, Object.keys(ns).join()].join(" ");
  tell("before", shown);
  const spy = spyOn(ns, "notExported");
  tell("spied", shown);
  spy.mockRestore();
  tell("restored", shown);
  spyOn(ns, "alsoAbsent");
  mock.restore();
  tell("restored by mock.restore()", () => ["alsoAbsent" in ns, Object.keys(ns).join()].join(" "));
  tell("required", () => Object.keys(require("./src/c.cjs")).join());
});
test("the mock", async () => {
  mock.module("./src/c.cjs", () => ({ exported: () => "mocked" }));
  tell("mocked", () => require("./src/c.cjs").exported());
});
`,
  "d.test.mjs": `import { test, spyOn, mock } from "bun:test";
const tell = (name, ask) => { try { console.log(name + ":", ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).slice(0, 110)); } };
mock.module("./src/m.mjs", () => ({ exported: () => "mocked" }));
test("a name that a mock in front of the load leaves out", async () => {
  const ns = await import("./src/m.mjs");
  tell("mocked", () => [String(ns.value), "value" in ns, Object.keys(ns).join()].join(" "));
  const spy = spyOn(ns, "value");
  tell("spied", () => [String(ns.value), "value" in ns].join(" "));
  spy.mockRestore();
  tell("restored", () => [String(ns.value), "value" in ns, Object.keys(ns).join()].join(" "));
});
`,
  "e.test.mjs": `import { test, spyOn, mock } from "bun:test";
const tell = async (name, ask) => { try { console.log(name + ":", await ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).split("/").pop().slice(0, 90)); } };
test("a module that links to the name behind the restore", async () => {
  const ns = await import("./src/c.cjs");
  spyOn(ns, "notExported").mockRestore();
  await tell("a later import of the name", async () => (await import("./src/late.mjs")).seen);
  await tell("another holder of the object", async () => { const star = await import("./src/star.mjs"); return [star.keys(), star.has("notExported")].join(" "); });
  const barrel = await import("./src/barrel.mjs");
  spyOn(barrel, "absentBehindAStar").mockRestore();
  await tell("through a star", async () => [Object.keys(barrel).join(), "absentBehindAStar" in barrel, "absentBehindAStar" in ns].join(" "));
});
`,
  "f.test.mjs": `import { test, spyOn, mock } from "bun:test";
const tell = async (name, ask) => { try { console.log(name + ":", await ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).split("/").pop().slice(0, 90)); } };
test("the same where the file may be mocked", async () => {
  const ns = await import("./src/c.cjs");
  spyOn(ns, "notExported").mockRestore();
  await tell("a later import of the name", async () => (await import("./src/late.mjs")).seen);
  await tell("another holder of the object", async () => { const star = await import("./src/star.mjs"); return [star.keys(), star.has("notExported")].join(" "); });
  const barrel = await import("./src/barrel.mjs");
  spyOn(barrel, "absentBehindAStar").mockRestore();
  await tell("through a star", async () => [Object.keys(barrel).join(), "absentBehindAStar" in barrel, "absentBehindAStar" in ns].join(" "));
});
test("the mock", () => { mock.module("./src/c.cjs", () => ({ exported: () => "mocked" })); });
`,
  "g.test.mjs": `import { test } from "bun:test";
const tell = async (name, ask) => { try { console.log(name + ":", await ask()); } catch (error) { console.log(name + " throws:", error.name, String(error.message).split("/").pop().slice(0, 90)); } };
test("no spy at all", async () => {
  await import("./src/c.cjs");
  await tell("without a spy, a later import of the name", async () => (await import("./src/late.mjs")).seen);
  await tell("without a spy, through a star", async () => Object.keys(await import("./src/barrel.mjs")).join());
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a spy on a name that a module does not export leaves nothing behind, ${way}`, async () => {
    using dir = tempDir("aot-a-spy-on-a-name-that-is-not-exported", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("spyOn of a name that is not exported: function");
    expect(plain.stdout).toContain("the name afterwards: undefined,false,false,false");
    expect(plain.stdout).toContain("called through the object: undefined,0");
    expect(plain.stdout).toContain("a later import of the name throws: SyntaxError c.cjs'.");
    expect(plain.stdout).toContain("through a star: exported,value false false");
    expect(plain.stdout).toContain("without a spy, a later import of the name throws: SyntaxError c.cjs'.");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
