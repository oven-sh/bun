import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A name reaches an importer through files that hand it on. A mock may stand in place of any of them:
// of several `export *` the first that has the name answers, and a mock has what its factory gave;
// a name that the factory left out is undefined through `export *` and `export { name } from`, and only whoever imports it from the mocked file itself hears what the mock makes of that.
const said = `const said = read => { try { return String(read()); } catch (error) { return "throws " + error.message.slice(0, 32); } };`;
const userOf = (barrel: string) => `import * as ns from "${barrel}";
const read = key => { try { return String(typeof ns[key] === "function" ? ns[key]() : ns[key]); } catch (error) { return "threw " + error.name; } };
export const seen = () => ["x", "y", "f", "extra", "side", "own", "second"].map(key => key + "=" + read(key)).join(" ") + " keys=" + Object.keys(ns).sort().join("+");`;
const nextFile = `import { test } from "bun:test";
import { seen } from "./user.js";
test("b", () => console.log("SEEN b", seen()));`;
const takesOriginal = `import { vi, test } from "bun:test";
vi.mock("./barrel.js", async original => ({ ...(await original()), x: "over x" }));
import { seen } from "./user.js";
test("a", async () => {
  const ns = await import("./barrel2.js");
  console.log("SEEN a", seen(), ns.x, ns.y, typeof ns.f, Object.keys(ns).sort().join("+"));
});`;
const projects: Record<string, Record<string, string>> = {
  "two stars": {
    "leaf.js": `console.log("SEEN runs leaf"); export const x = "real";`,
    "barrel.js": `console.log("SEEN runs barrel"); export * from "./leaf.js"; export const own = "real";`,
    "barrel-first.js": `export * from "./barrel.js"; export * from "./leaf.js";`,
    "leaf-first.js": `export * from "./leaf.js"; export * from "./barrel.js";`,
    "bindings.js": `import { x as leafFirst, own } from "./leaf-first.js"; import { x as barrelFirst } from "./barrel-first.js"; export const seen = () => [leafFirst, barrelFirst, own].join();`,
    "x.test.js": `import { test, vi } from "bun:test";
import { seen } from "./bindings.js";
import { x } from "./barrel-first.js";
import * as leafFirst from "./leaf-first.js";
import * as barrelFirst from "./barrel-first.js";
vi.mock("./barrel.js", () => ({ x: "mocked", own: "mocked" }));
test("t", () => console.log("SEEN", seen(), x, JSON.stringify([{ ...leafFirst }, { ...barrelFirst }]), Object.keys(barrelFirst).join()));`,
  },
  "the first star's mock lacks the name": {
    "leaf.js": `console.log("SEEN runs leaf"); export const x = "real";`,
    "barrel.js": `console.log("SEEN runs barrel"); export * from "./leaf.js"; export const own = "real";`,
    "first.js": `export * from "./barrel.js"; export * from "./leaf.js";`,
    "bindings.js": `import { x } from "./first.js"; export const seen = () => x;`,
    "x.test.js": `import { test, vi } from "bun:test";
import { seen } from "./bindings.js";
import { x } from "./first.js";
import * as first from "./first.js";
vi.mock("./barrel.js", () => ({ own: "mocked" }));
test("t", () => console.log("SEEN", seen(), x, JSON.stringify({ ...first })));`,
  },
  "a star below a star": {
    "barrel.js": `console.log("SEEN runs barrel"); export const x = "barrel";`,
    "middle.js": `export * from "./barrel.js";`,
    "outer.js": `export * from "./middle.js";`,
    "bindings.js": `import { x } from "./outer.js"; export const seen = () => x;`,
    "x.test.js": `import { test, vi } from "bun:test";
import { seen } from "./bindings.js";
import * as outer from "./outer.js";
vi.mock("./barrel.js", () => ({ x: "mocked", more: "more" }));
test("t", () => console.log("SEEN", seen(), JSON.stringify({ ...outer })));`,
  },
  "a name that the factory left out": {
    "leaf.js": `console.log("SEEN runs leaf"); export const a = "real"; export const missing = "real";`,
    "barrel.js": `export * from "./leaf.js"; export const own = "own";`,
    "outer.js": `export * from "./barrel.js";`,
    "named.js": `export { missing, missing as renamed } from "./leaf.js";`,
    "bindings.js": `import { a, missing, own } from "./barrel.js"; import { missing as outer } from "./outer.js"; import { missing as handedOn, renamed } from "./named.js"; import { missing as direct } from "./leaf.js";
export const reads = [() => a, () => missing, () => own, () => outer, () => handedOn, () => renamed, () => direct];`,
    "x.test.js": `import { test, vi } from "bun:test";
import { reads } from "./bindings.js";
import * as barrel from "./barrel.js";
import * as named from "./named.js";
vi.mock("./leaf.js", () => ({ a: "mocked" }));
${said}
test("t", () => console.log("SEEN", reads.map(said).join(" | "), said(() => barrel.missing), Object.keys(barrel).join(), Object.keys(named).join()));`,
  },
  "no getter runs for the keys": {
    "leaf.js": `export const token = "real"; export const other = 1;`,
    "star.js": `export * from "./leaf.js";`,
    "x.test.js": `import { test, vi } from "bun:test";
let reads = 0;
vi.mock("./leaf.js", () => ({ get token() { reads++; return "mock"; }, other: 2 }));
import * as star from "./star.js";
test("t", () => console.log("SEEN", Object.keys(star).sort().join(), reads, JSON.stringify(star), reads));`,
  },
  // The run follows the first star of stars.js, which leads to a CommonJS file. The second is settled by the build, and what comes by it is found in the table alone.
  "a star that the run follows beside one that it does not": {
    "common.cjs": `exports.c = x => x + 2;`,
    "starc.js": `export * from "./common.cjs";`,
    "lib.js": `export function f(x) { return x + 7; }`,
    "barrel.js": `export * from "./lib.js";`,
    "stars.js": `export * from "./starc.js"; export * from "./barrel.js";`,
    "x.test.js": `import { spyOn, test } from "bun:test";
import * as starC from "./starc.js";
import * as stars from "./stars.js";
import { c, f } from "./stars.js";
const made = name => name.split("").join("");
test("t", () => {
  console.log("SEEN", f(1), c(1), stars.f(1), starC.c(1), Object.keys(stars).join());
  if (globalThis.never) spyOn(starC, made("c"));
  const spy = spyOn(stars, made("f")).mockImplementation(() => "fake f");
  console.log("SEEN", stars.f(1), f(1));
  spy.mockRestore();
  console.log("SEEN", stars.c(1), c(1), stars.f(1), f(1));
});`,
  },
  "the factory returns a barrel over the mocked file": {
    "a.js": `export const a = "real";`,
    "b.js": `export const b = "real";`,
    "star.js": `export * from "./a.js";`,
    "named.js": `export { a } from "./a.js";`,
    "outer.js": `export * from "./star.js";`,
    "x.test.js": `import { test, mock } from "bun:test";
${said}
test("t", async () => {
  mock.module("./a.js", () => ({ a: "first" }));
  const ns = await import("./a.js");
  for (const barrel of [await import("./star.js"), await import("./named.js"), await import("./outer.js")]) {
    console.log("SEEN", said(() => mock.module("./a.js", () => barrel)), ns.a);
    console.log("SEEN", await mock.module("./a.js", async () => barrel).then(() => "settled", error => "rejects " + error.message.slice(0, 32)), ns.a);
  }
  const star = await import("./star.js");
  mock.module("./b.js", () => star);
  const b = await import("./b.js");
  console.log("SEEN", b.a, said(() => mock.module("./a.js", () => b)), ns.a);
});`,
  },
  // The first star of barrel.js is settled by the build. The second leads round the ring to barrel.js itself, the file that is mocked.
  "a ring of stars, and the next file mocks nothing": {
    "leaf.js": `export const x = "real x"; export function f() { return "real f"; }`,
    "barrel.js": `export * from "./leaf.js"; export * from "./barrel2.js";`,
    "barrel2.js": `export * from "./barrel.js"; export const second = "second";`,
    "a.test.js": `import { vi, test } from "bun:test";
vi.mock("./barrel.js", () => ({ x: "mock x" }));
import * as ns from "./barrel.js";
import * as behind from "./barrel2.js";
test("a", () => console.log("SEEN a", Object.keys(ns).join(), ns.x, Object.keys(behind).join(), behind.x, behind.second));`,
    "b.test.js": `import { test } from "bun:test";
import * as ns from "./barrel.js";
import * as behind from "./barrel2.js";
const key = name => name.split("").join("");
test("b", () => {
  console.log("SEEN b", Object.keys(ns).join(), ns.x, typeof ns.f, ns.second, ns[key("x")], typeof ns[key("f")]);
  console.log("SEEN b", Object.keys(behind).join(), behind.x, typeof behind.f, behind.second, behind[key("x")]);
});`,
  },
  "a ring of stars with an export of its own": {
    "leaf.js": `export const x = "real x"; export const y = "real y"; export function f() { return "real f"; }`,
    "barrel.js": `export * from "./leaf.js"; export const own = "own"; export * from "./barrel2.js";`,
    "barrel2.js": `export * from "./barrel.js"; export const second = "second";`,
    "user.js": userOf("./barrel.js"),
    "a.test.js": `import { mock, test } from "bun:test";
mock.module("./barrel.js", () => ({ x: "mock x", y: "mock y", f: () => "mock f", extra: "mock extra" }));
import { seen } from "./user.js";
test("a", async () => {
  const ns = await import("./barrel.js");
  console.log("SEEN a", seen(), ns.x, ns.y, typeof ns.f, ns.extra, Object.keys(ns).sort().join("+"));
});`,
    "b.test.js": nextFile,
  },
  // The build leaves the names out of the table of the file with the star, since the run follows the stars: so the run follows the star over such a mock too.
  "the factory takes the original, in a ring": {
    "leaf.js": `export const x = "real x"; export const y = "real y"; export function f() { return "real f"; }`,
    "side.js": `export const side = "real side";`,
    "barrel.js": `export * from "./leaf.js"; export * from "./side.js"; export * from "./barrel2.js";`,
    "barrel2.js": `export * from "./barrel.js"; export const second = "second";`,
    "user.js": userOf("./barrel2.js"),
    "a.test.js": takesOriginal,
    "b.test.js": nextFile,
  },
  "the factory takes the original, and the leaf imports the barrel": {
    "leaf.js": `import * as back from "./barrel.js"; export const sawBarrel = () => Object.keys(back).sort().join("+");
export const x = "real x"; export const y = "real y"; export function f() { return "real f"; }`,
    "barrel.js": `import { x, y, f } from "./leaf.js"; export { x, y, f };`,
    "barrel2.js": `export * from "./barrel.js";`,
    "user.js": userOf("./barrel2.js"),
    "a.test.js": takesOriginal,
    "b.test.js": nextFile,
  },
  "no mock stands": {
    "leaf.js": `console.log("SEEN runs leaf"); export const x = "real";`,
    "barrel.js": `console.log("SEEN runs barrel"); export * from "./leaf.js"; export const own = "real";`,
    "first.js": `export * from "./barrel.js"; export * from "./leaf.js";`,
    "bindings.js": `import { x, own } from "./first.js"; export const seen = () => x + own;`,
    "mocks-it.js": `import { vi } from "bun:test"; export const lay = () => vi.doMock("./barrel.js", () => ({ x: "mocked", own: "mocked" }));`,
    "x.test.js": `import { test } from "bun:test";
import { seen } from "./bindings.js";
import * as first from "./first.js";
import "./mocks-it.js";
test("t", () => console.log("SEEN", seen(), JSON.stringify({ ...first })));`,
  },
};

async function expectToAgreeWithPlainBun(files: Record<string, string>) {
  using dir = tempDir("aot-mock-behind-barrels", { "package.json": `{ "name": "p", "type": "module" }`, ...files });
  const seen = async (flags: string[], words: string) => {
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
    return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN"));
  };
  const plain = await seen([], "");
  expect(plain.length).toBeGreaterThan(0);
  expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}

test.each(Object.keys(projects))(
  "%s: as plain Bun, as one program and in two layers",
  name => expectToAgreeWithPlainBun(projects[name]),
  600000,
);
