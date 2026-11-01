import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// Under `bun run` the first require("bun:sqlite") leaves a module object in require.cache, and that object answers every later require().
// mock.module() stores what its factory made into a module object that is there, so the next require() answers that very object.
// Where there is none yet, require() answers the `default` of an object with `__esModule`, as a copy of bun:sqlite is, and else the object that the factory made.
const steps: Record<string, (name: string, at: number) => string> = {
  // require() in the test file, in a CommonJS file, and in a file that is written while the test runs
  r: name => `tell("r", require("${name}"));`,
  h: () => `tell("h", helper());`,
  w: () => `tell("w", written());`,
  i: (name, at) => `{ const got = await import("${name}"); known.ns${at} ??= got; tell("i", got); }`,
  // Mocks: a plain object, one that says it is an ES module, a copy of what require() answers, a copy of the namespace object, one whose factory is async
  a: (name, at) => `mockWith("A${at}", { marker: "a${at}", mocked });`,
  b: (name, at) => `mockWith("B${at}", { __esModule: true, default: { marker: "d${at}" }, marker: "b${at}", mocked });`,
  s: (name, at) => `mockWith("S${at}", { ...require("${name}"), marker: "s${at}" });`,
  t: (name, at) => `mockWith("T${at}", { ...(known.ns${at} ??= await import("${name}")), marker: "t${at}" });`,
  p: (name, at) =>
    `{ const made = known.P${at} = { marker: "p${at}", mocked }; await mock.module("${name}", async () => made); }`,
  x: () => `Bun.plugin.clearAll();`,
  d: name => `delete require.cache["${name}"];`,
};

const orders = [
  // Required, then mocked.
  ..."ra rb rs rt rp ha hb wa wb rab rba rar rbr rah rbh raw rbw rai rbi raxb rabr srs".split(" "),
  // Imported, then mocked.
  ..."ia ib is it ip iab ibb ibr ibh ibw iaw iar iara iarb ibra iahb iax".split(" "),
  // Both.
  ..."ria rib ira irb iha ihb iwa iwb ris rit irs irt riab irab".split(" "),
  // Mocked first.
  ..."a b s t p ar br arb bra arba abrb brab airb arib awb tr ax".split(" "),
  // Taken out of require.cache, which takes the module from the loader too.
  ..."rd rda rad radr radb ard ardb iad iadb iard iardb".split(" "),
];
const ordersInLayers = "ra rb rs ha wb rbw rabr ia ib it ibw iarb irb ris a b arb rad iard".split(" ");

const testFileOf = (name: string, order: string) => (id: string) => `
  import { mock, test } from "bun:test";
  import { rmSync, writeFileSync } from "node:fs";
  import helper from "./helper.cjs";
  ${sayOf(id)}
  function mocked() {}
  const known = {}, told = [];
  function what(value) {
    for (const key in known) if (known[key] === value) return key;
    return [Object.prototype.toString.call(value).slice(8, -1), Object.keys(value).length, value.marker, value.__esModule, Object.isExtensible(value)].join("/");
  }
  function tell(step, value) { told.push(step + "=" + what(value)); }
  function mockWith(key, made) {
    known[key] = made;
    if (Object(made.default) === made.default) known[key + ".default"] ??= made.default;
    mock.module("${name}", () => made);
  }
  let requireInWrittenFile;
  function written() {
    if (!requireInWrittenFile) {
      writeFileSync(import.meta.dir + "/written.cjs", 'module.exports = () => require("${name}");');
      requireInWrittenFile = require(import.meta.dir + "/written.cjs");
      rmSync(import.meta.dir + "/written.cjs");
    }
    return requireInWrittenFile();
  }
  test("${id}", async () => {
    ${[...order].map((step, at) => steps[step](name, at)).join("\n    ")}
    tell("R", require("${name}"));
    tell("H", helper());
    tell("M", import.meta.require("${name}"));
    tell("C", require(["${name.slice(0, 2)}", "${name.slice(2)}"].join("")));
    tell("W", written());
    tell("I", await import("${name}"));
    tell("R", require("${name}"));
    say(told.join(" "));
  });`;

const shared = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}" };
const asOneProgram = casesOfOneRun("a-mock-behind-a-require", shared, [[[]], [["--debug-aot"]]], test);
// Each test file is an image of its own over the image of the library, so the loader of the host stands between them.
const inLayers = casesOfOneRun(
  "a-mock-behind-a-require-in-layers",
  shared,
  [[[]], [["--debug-aot"], "TestRunLayers:2,TestRunPartFiles:1"]],
  test,
);

// One with code whose exports say `__esModule`, one with code, one of native code.
for (const name of ["bun:sqlite", "ws", "bun:jsc"]) {
  const casesIn = (project: typeof asOneProgram, orders: string[]) => {
    const helper = { "helper.cjs": `module.exports = () => require("${name}");` };
    const ids = orders.map(order => project.add(testFileOf(name, order), helper));
    return (ran: Awaited<ReturnType<typeof project.ran>>) =>
      orders.map((order, index) => `${order}: ${ran.get(ids[index])?.result} ${ran.get(ids[index])?.printed.trim()}`);
  };

  const toldAsOneProgram = casesIn(asOneProgram, orders);
  test(`require("${name}") in every order of require, import and mock`, async () => {
    const plain = toldAsOneProgram(await asOneProgram.ran());
    // The object that the factory made and its `default` are among the answers. The namespace object that an import got first is not.
    const lastAnswerOf = (order: string) => plain[orders.indexOf(order)].split(" ").at(-1);
    expect(["ra", "ib", "ia"].map(lastAnswerOf)).toEqual(["R=A1", "R=B1.default", "R=A1"]);
    expect(plain.filter(line => !line.includes(": pass "))).toEqual([]);
    expect(toldAsOneProgram(await asOneProgram.ran(["--debug-aot"]))).toEqual(plain);
  });

  const toldInLayers = casesIn(inLayers, ordersInLayers);
  test(`require("${name}") where each test file is an image of its own`, async () => {
    const plain = toldInLayers(await inLayers.ran());
    expect(plain.filter(line => !line.includes(": pass "))).toEqual([]);
    expect(toldInLayers(await inLayers.ran(["--debug-aot"], "TestRunLayers:2,TestRunPartFiles:1"))).toEqual(plain);
  });
}
