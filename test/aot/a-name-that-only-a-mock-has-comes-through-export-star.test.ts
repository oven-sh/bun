import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "a-name-that-only-a-mock-has-comes-through-export-star" }`,
  "show.ts": `
    const asked = ["v", "extra", "f", "w", "both", "more", "default", "c", "p", "own"];
    export const show = (label: string, B: any, hidden: string[] = []) =>
      console.log(
        label, "|", Object.keys(B).filter(key => !hidden.includes(key)).join(), "|",
        asked.filter(key => !hidden.includes(key)).map(key => key + "=" + String(B[key]) + ":" + (key in B) + ":" + Object.hasOwn(B, key)).join(" "), "|",
        JSON.stringify(Object.getOwnPropertyDescriptor(B, "extra")), JSON.stringify({ ...B }), B["ex" + "tra"],
      );`,
  "src/other.ts": `export const v = "real v"; export function f() {} export default "real default";`,
  "src/second.ts": `export const v = "second v"; export const w = "w";`,
  "src/adds.ts": `export const extra = "real extra";`,
  "src/plain.ts": `export const p = "p";`,
  "src/common.cjs": `module.exports = { c: "c", extra: "of the CommonJS file" };`,
  "src/barrel.ts": `export * from "./other.ts"; export const own = "own";`,
  "src/outer.ts": `export * from "./barrel.ts"; export const outer = "outer";`,
  "src/both.ts": `export * from "./plain.ts"; export * from "./other.ts";`,
  "src/hides.ts": `export * from "./other.ts"; export const extra = "of the barrel itself";`,
  "src/over-hides.ts": `export * from "./hides.ts";`,
  "src/left.ts": `export * from "./other.ts";`,
  "src/right.ts": `export * from "./other.ts";`,
  "src/diamond.ts": `export * from "./left.ts"; export * from "./right.ts";`,
  "src/ambiguous.ts": `export * from "./other.ts"; export * from "./second.ts";`,
  "src/clash.ts": `export * from "./other.ts"; export * from "./adds.ts";`,
  "src/circle-a.ts": `export * from "./circle-b.ts"; export const a = "a";`,
  "src/circle-b.ts": `export * from "./circle-a.ts"; export * from "./other.ts"; export const b = "b";`,
  "src/over-commonjs.ts": `export * from "./barrel.ts"; export * from "./common.cjs";`,
  "src/inner.ts": `export * from "./plain.ts"; export const inner = "inner";`,
  "src/over-inner.ts": `export * from "./inner.ts";`,
  "src/by-name.ts": `export * as space from "./other.ts"; export { v as renamed } from "./other.ts";`,
  "src/user.ts": `import * as B from "./barrel.ts"; export const used = () => B;`,
  "src/named.ts": `import { v, own } from "./barrel.ts"; export const named = () => v + " " + own;`,
  "ahead.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("the mock comes ahead of every load", async () => {
      mock.module("./src/other.ts", () => ({ v: "mocked v", extra: "extra", default: "mocked default" }));
      show("one star", await import("./src/barrel.ts"));
      show("two stars", await import("./src/outer.ts"));
      show("beside another module", await import("./src/both.ts"));
      show("a name of the barrel itself", await import("./src/hides.ts"));
      show("above a name of the barrel itself", await import("./src/over-hides.ts"));
      show("by two ways", await import("./src/diamond.ts"));
      show("a name that two modules have", await import("./src/ambiguous.ts"));
      show("another module has the new name", await import("./src/clash.ts"));
      show("a circle", await import("./src/circle-a.ts"));
      show("the circle from its other end", await import("./src/circle-b.ts"));
      // TODO: whether the CommonJS file has a name that the mock leaves out is known once it has run, and a link asks earlier: "f" is listed.
      show("a CommonJS file has the new name", await import("./src/over-commonjs.ts"), ["f"]);
      show("import * as", (await import("./src/user.ts")).used());
      show("require", require("./src/barrel.ts"));
      const byName: any = await import("./src/by-name.ts");
      show("export * as", byName.space);
      console.log("by name", (await import("./src/named.ts")).named(), byName.renamed, Object.keys(byName).join());
      show("the module itself", await import("./src/other.ts"));
    });`,
  "computed.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("the files with the stars are named at run time", async () => {
      mock.module("./src/other.ts", () => ({ v: "mocked v", extra: "extra" }));
      for (const name of ["barrel", "outer", "both", "hides", "diamond", "ambiguous", "clash", "circle-a"]) show(name, await import("./src/" + name + ".ts"));
    });`,
  "two.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("two mocks below one file", async () => {
      mock.module("./src/other.ts", () => ({ v: "mocked v", extra: "extra", both: "of other" }));
      mock.module("./src/second.ts", () => ({ w: "mocked w", both: "of second", more: "more" }));
      show("one of the two leaves the name out, and both have a new one", await import("./src/ambiguous.ts"));
    });`,
  "itself.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("the file with the star is mocked", async () => {
      mock.module("./src/inner.ts", () => ({ inner: "mocked inner", extra: "extra" }));
      show("itself", await import("./src/inner.ts"));
      show("above it", await import("./src/over-inner.ts"));
    });`,
  "behind.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("the mock comes behind the first load", async () => {
      show("before", await import("./src/barrel.ts"));
      mock.module("./src/other.ts", () => ({ v: "mocked v", extra: "extra" }));
      show("after", await import("./src/barrel.ts"));
      show("two stars", await import("./src/outer.ts"));
    });`,
  "twice.test.ts": `
    import { test, mock } from "bun:test";
    import { show } from "./show.ts";
    test("a second mock has another name", async () => {
      mock.module("./src/other.ts", () => ({ v: "mocked v", extra: "extra" }));
      const B: any = await import("./src/barrel.ts");
      show("first", B);
      mock.module("./src/other.ts", () => ({ v: "again", extra: "extra again", more: "more" }));
      show("second", B);
    });`,
  "none.test.ts": `
    import { test } from "bun:test";
    import { show } from "./show.ts";
    test("no mock in this file", async () => {
      for (const name of ["barrel", "outer", "both", "hides", "diamond", "ambiguous", "clash", "circle-a", "over-commonjs"]) show(name, await import("./src/" + name + ".ts"));
      show("one star", await import("./src/barrel.ts"));
      show("a name that two modules have", await import("./src/ambiguous.ts"));
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("a-name-that-only-a-mock-has-comes-through-export-star", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain(
    "one star | extra,own,v | v=mocked v:true:true extra=extra:true:true f=undefined:false:false",
  );
  expect(plain.printed).toContain("another module has the new name | extra,v |");
  expect(plain.printed).toContain(
    "one of the two leaves the name out, and both have a new one | both,extra,more,v,w |",
  );
  // TODO(bun), row 4105: a compiled run follows plain Bun but for a name that the mock adds and a CommonJS file behind a later `export *` really has: in plain Bun the first star
  // wins, compiled the file that really has it. The list goes red once they agree.
  const compiled = await printedBy(String(directory), words, "--aot");
  expect(compiled.exitCode).toBe(plain.exitCode);
  const printed = compiled.printed.split("\n");
  const differing = plain.printed.split("\n").filter((line, index) => line !== printed[index]);
  expect(differing.map(line => line.split(" | ")[0])).toEqual(["a CommonJS file has the new name"]);
  expect(compiled.printed).toContain(
    "a CommonJS file has the new name | c,extra,own,v | v=mocked v:true:true extra=of the CommonJS file:true:true",
  );
});
