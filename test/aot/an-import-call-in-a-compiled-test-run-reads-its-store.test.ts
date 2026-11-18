import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A compiled test run reads the text of what an import() names in a later turn, and makes the call again then. What the import()
// loads still reads the store of AsyncLocalStorage that the call was made under, as under `bun test`.
const files = {
  "stores.test.js": `import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
const seen = [];
globalThis.see = label => seen.push(label + " " + store.getStore());
test("what an import() loads reads the store of the call", async () => {
  await store.run("first", () => import("./graph.mjs"));
  await store.run("second", () => import("./other.mjs"));
  expect(seen).toEqual(["file first", "below first", "graph first", "other second"]);
});
`,
  "graph.mjs": `import "./below.mjs";
import "./file.cjs";
see("graph");
`,
  "below.mjs": `see("below");
export {};
`,
  "file.cjs": `see("file");
module.exports = {};
`,
  "other.mjs": `see("other");
export {};
`,
};

async function passes(command: string) {
  using dir = tempDir("aot-store-of-an-import-call-in-a-test-run", files);
  const tested = await run([bunExe(), ...command.split(" "), "./stores.test.js"], String(dir), bunEnv);
  expect(tested.stderr).toContain("1 pass");
  expect(tested.exitCode).toBe(0);
}

test.each(["test", "test --isolate", "test --aot"])("bun %s", passes);

// The cases below run a project under bun test and under bun test --aot, and each project expects what bun test prints.
// A row that is `todo` is a known wrong answer of the compiled run: its reason stands beside it.
const ofCompiledRun = (command: string) => (command.includes("--aot") ? { IS_COMPILED_TEST_RUN: "1" } : {});
async function passesIn(files: Record<string, string>, command: string, testFile: string, passed: number) {
  using dir = tempDir("aot-import-call-made-again-in-a-test-run", files);
  const tested = await run([bunExe(), ...command.split(" "), testFile], String(dir), {
    ...bunEnv,
    ...ofCompiledRun(command),
    // A compiled run reads the text of what an import() names on another thread, as users run it: whoever runs this
    // file may have switched that thread off.
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "0",
  });
  expect(tested.stderr).toContain(`${passed} pass`);
  expect(tested.exitCode).toBe(0);
  return tested;
}

const storeAndLines = `const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const isBefore = (one, other) => read.indexOf(one) !== -1 && read.indexOf(one) < read.indexOf(other);
`;

// A file waits where it calls Bun.build(): the call runs the event loop until setup() of a plugin has ended. The text of what
// an import() named before comes in one of those rounds of the loop, so the call is made again while the file waits. That
// wait is to go away (oven-sh/bun#33261). Each test below first checks that setup() ended inside the file: without that no
// call is made again there, and the test shows nothing.
const fileThatWaits = (label: string, built: string, waitInSetup: string) => `see("${label}waits begins");
globalThis.${built} = Bun.build({
  entrypoints: ["./built.js"],
  plugins: [
    {
      name: "waits",
      async setup() {
        see("${label}setup begins");
        ${waitInSetup}
        see("${label}setup ends");
      },
    },
  ],
}).then(
  () => see("${label}build settled"),
  () => see("${label}build failed"),
);
see("${label}waits ends");
exports.name = "waits";
`;
// Each round parks the loop until something wakes it: the thread that reads the text does.
const fourRoundsOfLoop = "for (let round = 0; round < 4; round++) await new Promise(resolve => setImmediate(resolve));";

// An ES module that require() loads. Its second file is left to run time, so the loader loads it in a step of its own, and
// its third file waits: the compiled run has that step still in front of the file where the call is made again.
const requiredGraph = (letter: string, outside: string, more = "") => ({
  [`${letter}-root.mjs`]: `import { name as first } from "./${letter}-first.cjs";
import outside from "./${letter}-outside.cjs?left-to-run-time";
import { name as waits } from "./${letter}-waits.cjs";
${more}see("${letter}: root");
export const name = "root over " + first + ", " + outside.label + ", " + waits;
`,
  [`${letter}-first.cjs`]: `see("${letter}: first");
exports.name = "first";
`,
  [`${letter}-outside.cjs`]: outside,
  [`${letter}-waits.cjs`]: fileThatWaits(`${letter}: `, `built${letter}`, fourRoundsOfLoop),
  [`${letter}-leaf.mjs`]: `see("${letter}: leaf");
export {};
`,
});
const outsideThatReads = (letter: string) => `globalThis.see("${letter}: outside");
module.exports = { label: "outside" };
`;

// The call is made again while require() loads an ES module: a CommonJS file of that module waits, and steps of the required
// graph are still in front of that file. Those steps are no part of the call. The file that they load reads what the caller of
// require() has: not the store of the call, and not none where the call has no store.
// The two files under a query are spelled once more where no run comes, so this run is compiled as an executable is
// (no TS100079).
const filesOfCallsMadeAgainInsideRequire = {
  "built.js": `export default 1;
`,
  ...requiredGraph("a", outsideThatReads("a")),
  ...requiredGraph("b", outsideThatReads("b")),
  "calls.test.cjs": `const { test, expect } = require("bun:test");
${storeAndLines}if (process.argv.length > 99) {
  require("./a-outside.cjs");
  require("./b-outside.cjs");
}
test("a call under a store is made again while a required graph waits", async () => {
  read.length = 0;
  const leaf = store.run("held", () => import("./a-leaf.mjs"));
  const root = require("./a-root.mjs");
  see("a: test goes on with " + root.name);
  await Promise.all([leaf, globalThis.builta]);
  see("a: test ends");
  expect(isBefore("a: setup ends undefined", "a: waits ends undefined")).toBe(true);
  expect(isBefore("a: leaf undefined", "a: test goes on with root over first, outside, waits undefined")).toBe(true);
  expect(read.sort()).toEqual([
    "a: build settled undefined",
    "a: first undefined",
    "a: leaf undefined",
    "a: outside undefined",
    "a: root undefined",
    "a: setup begins undefined",
    "a: setup ends undefined",
    "a: test ends undefined",
    "a: test goes on with root over first, outside, waits undefined",
    "a: waits begins undefined",
    "a: waits ends undefined",
  ]);
});
test("a call without a store is made again while a graph that is required under a store waits", async () => {
  read.length = 0;
  const leaf = import("./b-leaf.mjs");
  const root = store.run("R", () => require("./b-root.mjs"));
  see("b: test goes on with " + root.name);
  await Promise.all([leaf, globalThis.builtb]);
  see("b: test ends");
  expect(isBefore("b: setup ends R", "b: waits ends R")).toBe(true);
  expect(isBefore("b: leaf R", "b: test goes on with root over first, outside, waits undefined")).toBe(true);
  expect(read.sort()).toEqual([
    "b: build settled R",
    "b: first R",
    "b: leaf R",
    "b: outside R",
    "b: root R",
    "b: setup begins R",
    "b: setup ends R",
    "b: test ends undefined",
    "b: test goes on with root over first, outside, waits undefined",
    "b: waits begins R",
    "b: waits ends R",
  ]);
});
`,
};

test.each(["test", "test --aot"])("bun %s, where a call is made again inside require()", async command => {
  const tested = await passesIn(filesOfCallsMadeAgainInsideRequire, command, "./calls.test.cjs", 2);
  expect(tested.stderr).not.toContain("TS100079");
});

// A step of the required graph evaluates a module that awaits: mock.module() does that for a module that a failed load
// left linked. The module that waits for that await goes on in what the caller of require() has, not in the store of the call.
const filesOfStepThatEvaluatesModuleThatAwaits = {
  "built.js": `export default 1;
`,
  ...requiredGraph(
    "a",
    `globalThis.see("a: outside");
globalThis.layMock();
module.exports = { label: "outside" };
`,
  ),
  "fails.mjs": `import "./throws.mjs";
import "./waits-for-await.mjs";
export {};
`,
  "throws.mjs": `throw new Error("thrown in front of the module that waits");
`,
  "waits-for-await.mjs": `import "./awaits.mjs";
see("the module that waited for the await");
globalThis.didWait();
export {};
`,
  "awaits.mjs": `see("the module that awaits begins");
await new Promise(resolve => (globalThis.goOn = resolve));
see("the module that awaits goes on");
export {};
`,
  "evaluates.test.cjs": `const { test, expect, mock } = require("bun:test");
${storeAndLines}const waitsForAwait = require.resolve("./waits-for-await.mjs");
globalThis.layMock = () => mock.module(waitsForAwait, () => ({}));
test("a step of a required graph evaluates a module that awaits, where a call under a store is made again", async () => {
  const waited = new Promise(resolve => (globalThis.didWait = resolve));
  await import("./fails.mjs").catch(() => see("the load of fails.mjs failed"));
  const leaf = store.run("held", () => import("./a-leaf.mjs"));
  const root = require("./a-root.mjs");
  see("a: test goes on with " + root.name);
  globalThis.goOn();
  await Promise.all([leaf, globalThis.builta, waited]);
  see("a: test ends");
  expect(isBefore("a: setup ends undefined", "a: waits ends undefined")).toBe(true);
  expect(isBefore("the module that awaits begins undefined", "a: test goes on with root over first, outside, waits undefined")).toBe(true);
  expect(read.sort()).toEqual([
    "a: build settled undefined",
    "a: first undefined",
    "a: leaf undefined",
    "a: outside undefined",
    "a: root undefined",
    "a: setup begins undefined",
    "a: setup ends undefined",
    "a: test ends undefined",
    "a: test goes on with root over first, outside, waits undefined",
    "a: waits begins undefined",
    "a: waits ends undefined",
    "the load of fails.mjs failed undefined",
    "the module that awaits begins undefined",
    "the module that awaits goes on undefined",
    "the module that waited for the await undefined",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where a call is made again inside require() and a step of the required graph evaluates a module that awaits",
  command => passesIn(filesOfStepThatEvaluatesModuleThatAwaits, command, "./evaluates.test.cjs", 1),
);

// The factory of a mock below the call runs where the call is made again, and calls require() of a module that reaches the
// graph of the file that waits: that require() hands the graph to the loader. The file that the steps load reads what the
// caller of the first require() has. What the factory and the modules that it requires read is another matter: see the
// rows below that are todo.
const filesOfFactoryThatRequiresInsideCallMadeAgain = {
  "built.js": `export default 1;
`,
  ...requiredGraph("a", outsideThatReads("a"), `import "./a-sibling.mjs";\n`),
  "a-sibling.mjs": `export const name = "sibling";
`,
  "a-other.mjs": `import { name as sibling } from "./a-sibling.mjs";
export const name = "other over " + sibling;
`,
  "a-mocked.mjs": `export const value = "real";
`,
  "a-uses-mock.mjs": `import { value } from "./a-mocked.mjs";
see("a: leaf with " + value);
export {};
`,
  "requires.test.cjs": `const { test, expect, mock } = require("bun:test");
${storeAndLines}test("the factory of a mock below a call that is made again calls require() while a required graph waits", async () => {
  const leaf = store.run("held", () => import("./a-uses-mock.mjs"));
  mock.module("./a-mocked.mjs", () => {
    read.push("a: the factory begins");
    read.push("a: the factory required " + require("./a-other.mjs").name);
    return { value: "mocked" };
  });
  const root = require("./a-root.mjs");
  see("a: test goes on with " + root.name);
  await Promise.all([leaf, globalThis.builta]);
  see("a: test ends");
  expect(isBefore("a: setup ends undefined", "a: waits ends undefined")).toBe(true);
  // In a compiled run the factory runs where the call is made again, in front of the step that loads the second file.
  if (process.env.IS_COMPILED_TEST_RUN) expect(isBefore("a: the factory begins", "a: outside undefined")).toBe(true);
  expect(read.sort()).toEqual([
    "a: build settled undefined",
    "a: first undefined",
    "a: leaf with mocked undefined",
    "a: outside undefined",
    "a: root undefined",
    "a: setup begins undefined",
    "a: setup ends undefined",
    "a: test ends undefined",
    "a: test goes on with root over first, outside, waits undefined",
    "a: the factory begins",
    "a: the factory required other over sibling",
    "a: waits begins undefined",
    "a: waits ends undefined",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where a call is made again inside require() and the factory of its mock calls require()",
  command => passesIn(filesOfFactoryThatRequiresInsideCallMadeAgain, command, "./requires.test.cjs", 1),
);

// The call is made again while a CommonJS file of an import() without a store waits. The load of that import() goes on there:
// it asks a plugin for the next module. The load is no part of the call, so the hook of the plugin reads no store.
// Bun.plugin compiles the run so that every file can load again (TS100079): this case holds that compile alone.
// setup() waits for one job, so the wait has one round: the call is made again in it, and the hook is asked inside the call.
const filesOfCallMadeAgainWhereLoadGoesOn = {
  "built.js": `export default 1;
`,
  "root.mjs": `import { name as waits } from "./waits.cjs";
import outside from "./outside.cjs?left-to-run-time";
import { name as second } from "./second.cjs";
see("root over " + waits + ", " + outside.label + ", " + second);
`,
  "waits.cjs": fileThatWaits("", "built", "await 0;"),
  "outside.cjs": `globalThis.see("outside");
module.exports = { label: "outside" };
`,
  "second.cjs": `see("second");
exports.name = "second";
`,
  "leaf.mjs": `import "./below.mjs";
see("leaf");
`,
  "below.mjs": `see("below");
export {};
`,
  "hook.test.mjs": `import { expect, test } from "bun:test";
import { plugin } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const isBefore = (one, other) => read.indexOf(one) !== -1 && read.indexOf(one) < read.indexOf(other);
plugin({
  name: "reads the store",
  setup(build) {
    build.onLoad({ filter: /outside/ }, () => {
      see("onLoad of outside");
      return undefined;
    });
  },
});
test("the load of a file that waits goes on where a call under a store is made again", async () => {
  const root = import("./root.mjs");
  const leaf = store.run("held", () => import("./leaf.mjs"));
  await Promise.all([root, leaf]);
  await globalThis.built;
  see("test ends");
  expect(isBefore("setup ends undefined", "waits ends undefined")).toBe(true);
  if (process.env.IS_COMPILED_TEST_RUN) {
    const inTheWait = read.slice(read.indexOf("setup begins undefined") + 1, read.indexOf("setup ends undefined"));
    expect(inTheWait.map(line => line.replace(/ \\S+$/, ""))).toEqual(["onLoad of outside"]);
  }
  expect(read.sort()).toEqual([
    "below held",
    "build settled undefined",
    "leaf held",
    "onLoad of outside undefined",
    "outside undefined",
    "root over waits, outside, second undefined",
    "second undefined",
    "setup begins undefined",
    "setup ends undefined",
    "test ends undefined",
    "waits begins undefined",
    "waits ends undefined",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where a call is made again while the load of a file that waits goes on",
  command => passesIn(filesOfCallMadeAgainWhereLoadGoesOn, command, "./hook.test.mjs", 1),
);

// The same without a file that waits and without a call that is made again: a CommonJS file of an import() without a store
// evaluates a module of node:vm under a store, in a context with a queue of its own, and runs that queue. A module of
// node:vm calls import() there, inside a job that entered the store, and the load of the file goes on inside that call.
const filesOfLoadThatGoesOnInsideJobOfVM = {
  "root.mjs": `import { name as file } from "./file.cjs";
import outside from "./outside.cjs?left-to-run-time";
import { name as second } from "./second.cjs";
see("root over " + file + ", " + outside.label + ", " + second);
`,
  "file.cjs": `const vm = require("node:vm");
see("file begins");
sandbox.calls = () => {
  see("the module of node:vm calls import()");
  globalThis.inner = import("./inner.mjs");
  see("behind that call of import()");
};
store.run("V", () => vmParent.evaluate());
see("file behind evaluate()");
sandbox.open();
vm.runInContext("0", vmContext);
see("file behind the queue of the context");
exports.name = "file";
`,
  "inner.mjs": `see("inner");
export {};
`,
  "outside.cjs": `globalThis.see("outside");
module.exports = { label: "outside" };
`,
  "second.cjs": `see("second");
exports.name = "second";
`,
  "vm.test.mjs": `import { expect, test } from "bun:test";
import { plugin } from "bun";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const isBefore = (one, other) => read.indexOf(one) !== -1 && read.indexOf(one) < read.indexOf(other);
plugin({
  name: "reads the store",
  setup(build) {
    build.onLoad({ filter: /outside/ }, () => {
      see("onLoad of outside");
      return undefined;
    });
  },
});
test("the load of a file goes on where a module of node:vm under a store calls import()", async () => {
  // The first call of run() loads a part of Bun's library, and a load hands the graph of a file that runs to the loader.
  store.run("a store before the file", () => see("test inside run()"));
  globalThis.sandbox = { see: label => see(label), calls: () => {} };
  const context = vm.createContext(globalThis.sandbox, { microtaskMode: "afterEvaluate" });
  vm.runInContext("globalThis.gate = new Promise(resolve => { globalThis.open = resolve; });", context);
  const child = new vm.SourceTextModule('see("child of the vm graph"); await gate; see("child behind its await");', { context, identifier: "vm:child" });
  const parent = new vm.SourceTextModule('import "vm:child"; see("parent of the vm graph"); calls(); see("parent behind the call");', { context, identifier: "vm:parent" });
  await parent.link(() => child);
  globalThis.vmParent = parent;
  globalThis.vmContext = context;
  await import("./root.mjs");
  await globalThis.inner;
  see("test ends");
  // The module of node:vm ran inside the file, where the file runs the queue of the context.
  expect(isBefore("file behind evaluate() undefined", "the module of node:vm calls import() V")).toBe(true);
  expect(isBefore("behind that call of import() V", "file behind the queue of the context undefined")).toBe(true);
  if (process.env.IS_COMPILED_TEST_RUN) {
    const inTheCall = read.slice(read.indexOf("the module of node:vm calls import() V") + 1, read.indexOf("behind that call of import() V"));
    expect(inTheCall.map(line => line.replace(/ \\S+$/, ""))).toEqual(["onLoad of outside"]);
  }
  expect(read.sort()).toEqual([
    "behind that call of import() V",
    "child behind its await V",
    "child of the vm graph V",
    "file begins undefined",
    "file behind evaluate() undefined",
    "file behind the queue of the context undefined",
    "inner V",
    "onLoad of outside undefined",
    "outside undefined",
    "parent behind the call V",
    "parent of the vm graph V",
    "root over file, outside, second undefined",
    "second undefined",
    "test ends undefined",
    "test inside run() a store before the file",
    "the module of node:vm calls import() V",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where the load of a file goes on inside a job of node:vm under a store",
  command => passesIn(filesOfLoadThatGoesOnInsideJobOfVM, command, "./vm.test.mjs", 1),
);

// The async context holds more than stores: while the factory of a mock runs, it says whose factory runs, and an import()
// of the mocked module from there gets the module itself. So what reads the context of a call by mistake can get the
// module in place of its mock. Here the factory of a mock calls import(), that call is made again while a file of another
// import() waits, and the load of that file goes on there: the hook of a plugin asks for the mocked module and gets the mock.
const filesOfLoadThatGoesOnInsideCallOfFactory = {
  "built.js": `export default 1;
`,
  "root.mjs": `import { name as waits } from "./waits.cjs";
import outside from "./outside.cjs?left-to-run-time";
import { name as second } from "./second.cjs";
see("root over " + waits + ", " + outside.label + ", " + second);
export const name = "root";
`,
  "waits.cjs": fileThatWaits("", "built", "await 0;"),
  "outside.cjs": `globalThis.see("outside");
module.exports = { label: "outside" };
`,
  "second.cjs": `see("second");
exports.name = "second";
`,
  "mocked.mjs": `see("mocked.mjs itself");
export const value = "real";
`,
  "uses-mock.mjs": `import { value } from "./mocked.mjs";
see("uses-mock with " + value);
export {};
`,
  "late.mjs": `import "./below.mjs";
see("late");
export {};
`,
  "below.mjs": `see("below");
export {};
`,
  "asks.mjs": `import { plugin } from "bun";
globalThis.asked = [];
plugin({
  name: "asks for the mocked module",
  setup(build) {
    build.onLoad({ filter: /outside/ }, () => {
      see("onLoad of outside");
      globalThis.asked.push(import("./mocked.mjs").then(mocked => see("the hook got " + mocked.value)));
      return undefined;
    });
  },
});
`,
  "mock.test.mjs": `import { expect, mock, test } from "bun:test";
const read = [];
globalThis.see = label => read.push(label);
const isBefore = (one, other) => read.indexOf(one) !== -1 && read.indexOf(one) < read.indexOf(other);
await import("./asks.mjs");
test("the load of a file that waits goes on where a call that a factory made is made again", async () => {
  const began = Promise.withResolvers();
  const calls = Promise.withResolvers();
  const ends = Promise.withResolvers();
  mock.module("./mocked.mjs", async () => {
    see("the factory begins");
    began.resolve();
    await calls.promise;
    see("the factory calls import()");
    globalThis.late = import("./late.mjs");
    await ends.promise;
    see("the factory ends");
    return { value: "mocked" };
  });
  const uses = import("./uses-mock.mjs");
  await began.promise;
  const root = import("./root.mjs");
  calls.resolve();
  see("test goes on with " + (await root).name);
  ends.resolve();
  await Promise.all([uses, globalThis.late, globalThis.built, ...globalThis.asked]);
  see("test ends");
  expect(isBefore("setup ends", "waits ends")).toBe(true);
  expect(read.sort()).toEqual([
    "below",
    "build settled",
    "late",
    "onLoad of outside",
    "outside",
    "root over waits, outside, second",
    "second",
    "setup begins",
    "setup ends",
    "test ends",
    "test goes on with root",
    "the factory begins",
    "the factory calls import()",
    "the factory ends",
    "the hook got mocked",
    "uses-mock with mocked",
    "waits begins",
    "waits ends",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where a call that the factory of a mock made is made again while the load of a file that waits goes on",
  command => passesIn(filesOfLoadThatGoesOnInsideCallOfFactory, command, "./mock.test.mjs", 1),
);

// An import() that is called in the context of a Bun.ModuleGraph keeps no async context: neither the graph nor a store. Where
// the call waits for the text of its module, the factory of a mock below it runs where the call is made again, and reads
// none of the two, as under bun test.
const filesOfCallInContextOfModuleGraph = {
  ...Object.fromEntries(
    ["a", "b"].flatMap(letter => [
      [`${letter}-dep.mjs`, `see("${letter}: the original of dep");\nexport const name = "dep";\n`],
      [`${letter}-uses.mjs`, `import { name } from "./${letter}-dep.mjs";\nsee("${letter}: uses " + name);\n`],
    ]),
  ),
  "graph.test.mjs": `import { expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
const graph = new Bun.ModuleGraph();
const read = [];
const where = () => (Bun.ModuleGraph.current === graph ? "in the graph" : "in no graph");
globalThis.see = label => read.push(label + ", store " + store.getStore() + ", " + where());
test("the factory of a mock below an import() that the context of a module graph calls", async () => {
  for (const letter of ["a", "b"])
    mock.module("./" + letter + "-dep.mjs", () => {
      see(letter + ": factory of dep");
      return { name: "the mock of dep" };
    });
  await graph.run(() => {
    see("a: the call");
    return import("./a-uses.mjs");
  });
  await store.run("S", () =>
    graph.run(() => {
      see("b: the call");
      return import("./b-uses.mjs");
    }),
  );
  expect(read).toEqual([
    "a: the call, store undefined, in the graph",
    "a: factory of dep, store undefined, in no graph",
    "a: uses the mock of dep, store undefined, in no graph",
    "b: the call, store S, in the graph",
    "b: factory of dep, store undefined, in no graph",
    "b: uses the mock of dep, store undefined, in no graph",
  ]);
});
`,
};

test.each(["test", "test --aot"])("bun %s, where the context of a module graph calls import()", command =>
  passesIn(filesOfCallInContextOfModuleGraph, command, "./graph.test.mjs", 1),
);

// The same call where it reads no text: its mock takes the original, and the original is loaded. It is made again some jobs
// later, from a reaction of a promise, and here inside a CommonJS file of a required graph that drains the jobs. The steps of
// the required graph in front of that file run the factory of another mock: it reads neither the graph nor the store.
const filesOfCallInContextOfModuleGraphMadeAgainInsideRequire = {
  "package.json": `{ "name": "made-up-held", "type": "module" }
`,
  "mocked.js": `see("mocked.js itself");
export const value = "real";
`,
  "root.js": `import { name as first } from "./first.cjs";
import outside from "@made-up/outside";
import { name as drains } from "./drains.cjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + drains;
`,
  "first.cjs": `see("first");
exports.name = "first";
`,
  "drains.cjs": `see("drains begins");
require("bun:jsc").drainMicrotasks();
see("drains ends");
exports.name = "drains";
`,
  "graph.test.cjs": `const { test, expect, vi } = require("bun:test");
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();
const graph = new Bun.ModuleGraph();
const read = [];
const where = () => (Bun.ModuleGraph.current === graph ? "in the graph" : "in no graph");
globalThis.see = label => read.push(label + ", store " + store.getStore() + ", " + where());
vi.doMock("@made-up/outside", () => {
  see("the factory of outside");
  return { default: { label: "outside" } };
});
test("a call in the context of a module graph is made again inside a file of a required graph", async () => {
  vi.doMock("./mocked.js", original => {
    see("the factory of mocked.js");
    return { value: "mocked", takes: typeof original };
  });
  await vi.importActual("./mocked.js");
  const call = store.run("S", () =>
    graph.run(() => {
      see("the call");
      return import("./mocked.js");
    }),
  );
  const root = require("./root.js");
  see("test goes on with " + root.name);
  see("test ends with " + (await call).value);
  expect(read.sort()).toEqual([
    "drains begins, store undefined, in no graph",
    "drains ends, store undefined, in no graph",
    "first, store undefined, in no graph",
    "mocked.js itself, store undefined, in no graph",
    "root, store undefined, in no graph",
    "test ends with mocked, store undefined, in no graph",
    "test goes on with root over first, outside, drains, store undefined, in no graph",
    "the call, store S, in the graph",
    "the factory of mocked.js, store undefined, in no graph",
    "the factory of outside, store undefined, in no graph",
  ]);
});
`,
};

test.each(["test", "test --aot"])(
  "bun %s, where a call in the context of a module graph is made again inside a file of a required graph",
  command => passesIn(filesOfCallInContextOfModuleGraphMadeAgainInsideRequire, command, "./graph.test.cjs", 1),
);

// What follows passes under bun test and does not yet in a compiled run. Each row says why.
function knownWrongAnswerOfCompiledRun(where: string, files: Record<string, string>, testFile: string) {
  test(`bun test, ${where}`, () => passesIn(files, "test", testFile, 1));
  test.todo(`bun test --aot, ${where}`, () => passesIn(files, "test --aot", testFile, 1));
}

// A compiled run hands the async context of a call of import() on in the slot: to the load, and to what continues the call.
// So a call that is made again goes on under its own context, and what it runs at once reads that context: the factory of a
// mock below it. Under bun test a job of the load runs that factory, and in the drain of require() such a job enters
// nothing: the factory reads what the caller of require() has.
const filesOfFactoryInsideCallMadeAgainInsideRequire = (
  letter: string,
  call: string,
  requires: string,
  ofCaller: string,
) => ({
  "built.js": `export default 1;
`,
  ...requiredGraph(letter, outsideThatReads(letter)),
  "mocked.mjs": `export const value = "real";
`,
  "uses-mock.mjs": `import { value } from "./mocked.mjs";
see("${letter}: uses-mock with " + value);
export {};
`,
  "factory.test.cjs": `const { test, expect, mock } = require("bun:test");
${storeAndLines}test("the factory of a mock below a call that is made again inside require()", async () => {
  const uses = ${call};
  mock.module("./mocked.mjs", () => {
    see("${letter}: the factory");
    return { value: "mocked" };
  });
  const root = ${requires};
  await Promise.all([uses, globalThis.built${letter}]);
  expect(isBefore("${letter}: setup ends ${ofCaller}", "${letter}: waits ends ${ofCaller}")).toBe(true);
  expect(read.filter(line => line.startsWith("${letter}: the factory"))).toEqual(["${letter}: the factory ${ofCaller}"]);
});
`,
});
// The compiled run prints "a: the factory held".
knownWrongAnswerOfCompiledRun(
  "where the factory of a mock runs in a call under a store that is made again inside require()",
  filesOfFactoryInsideCallMadeAgainInsideRequire(
    "a",
    `store.run("held", () => import("./uses-mock.mjs"))`,
    `require("./a-root.mjs")`,
    "undefined",
  ),
  "./factory.test.cjs",
);
// The compiled run prints "b: the factory undefined".
knownWrongAnswerOfCompiledRun(
  "where the factory of a mock runs in a call without a store that is made again inside require() under a store",
  filesOfFactoryInsideCallMadeAgainInsideRequire(
    "b",
    `import("./uses-mock.mjs")`,
    `store.run("R", () => require("./b-root.mjs"))`,
    "R",
  ),
  "./factory.test.cjs",
);

// The same with no file that waits and no require(): a module of a load without a store imports a module that has run,
// enters a store, and lays the mock of a module below it anew. The call is made again in the same turn, in a job of the
// loader, and the new factory runs inside it. The compiled run prints "the second factory undefined".
const filesOfMockLaidAnewBehindEnterWith = {
  "mocked.mjs": `export const value = "real";
`,
  "uses-mock.mjs": `import { value } from "./mocked.mjs";
export const early = value;
`,
  "enters.mjs": `import { mock, vi } from "bun:test";
globalThis.again = import("./uses-mock.mjs");
store.enterWith("T");
vi.doUnmock("./mocked.mjs");
mock.module("./mocked.mjs", () => {
  see("the second factory");
  return { value: "mocked anew" };
});
export {};
`,
  "enters.test.mjs": `import { expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
test("a module lays a mock anew behind enterWith()", async () => {
  store.run("a store before the calls", () => {});
  mock.module("./mocked.mjs", () => {
    see("the first factory");
    return { value: "mocked" };
  });
  await import("./uses-mock.mjs");
  await import("./enters.mjs");
  expect((await globalThis.again).early).toBe("mocked anew");
  expect(read).toEqual(["the first factory undefined", "the second factory T"]);
});
`,
};
knownWrongAnswerOfCompiledRun(
  "where the factory of a mock runs in a call without a store that is made again in the turn in which a module entered a store",
  filesOfMockLaidAnewBehindEnterWith,
  "./enters.test.mjs",
);

// A call that is made again can wait behind the factory of a mock, and then goes on in a reaction of a promise, which is no
// job of the loader. Where that reaction runs inside a file of a required graph (the file drains the jobs), the step of
// the required graph that is in front of the file reads the store of the call. The compiled run prints
// "outside held" and "uses-mock with mocked undefined".
const filesOfCallThatWaitsBehindFactory = {
  "root.mjs": `import { name as first } from "./first.cjs";
import outside from "./outside.cjs?left-to-run-time";
import { name as drains } from "./drains.cjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + drains;
`,
  "first.cjs": `see("first");
exports.name = "first";
`,
  "outside.cjs": `globalThis.see("outside");
module.exports = { label: "outside" };
`,
  "drains.cjs": `see("drains begins");
globalThis.letFactoryEnd();
require("bun:jsc").drainMicrotasks();
see("drains ends");
exports.name = "drains";
`,
  "mocked.mjs": `export default "real";
`,
  "uses-mock.mjs": `import mocked from "./mocked.mjs";
see("uses-mock with " + mocked);
export {};
`,
  "reaction.test.cjs": `const { test, expect, mock } = require("bun:test");
${storeAndLines}test("a call that is made again waits behind a factory and goes on inside a required graph", async () => {
  const ends = Promise.withResolvers();
  const began = Promise.withResolvers();
  globalThis.letFactoryEnd = () => ends.resolve();
  const uses = store.run("held", () => import("./uses-mock.mjs"));
  mock.module("./mocked.mjs", async () => {
    began.resolve();
    await ends.promise;
    return { default: "mocked" };
  });
  await began.promise;
  const root = require("./root.mjs");
  see("test goes on with " + root.name);
  await uses;
  expect(read.sort()).toEqual([
  "drains begins undefined",
  "drains ends undefined",
  "first undefined",
  "outside undefined",
  "root undefined",
  "test goes on with root over first, outside, drains undefined",
  "uses-mock with mocked held",
  ]);
});
`,
};
knownWrongAnswerOfCompiledRun(
  "where a call that is made again waits behind the factory of a mock and goes on inside a file of a required graph",
  filesOfCallThatWaitsBehindFactory,
  "./reaction.test.cjs",
);

// An import() in the context of a module graph whose mocks do not wait for its text: here a module that require() loads makes
// the call, so the factory of the mock runs inside the call of import() itself, in the context of the caller. Under bun test a
// job of the load runs the factory, and the load keeps nothing. The compiled run prints
// "the factory, store S, in the graph", as that of Bun's main does.
const filesOfCallInContextOfModuleGraphWhoseMocksRunAtOnce = {
  "mocked.mjs": `export const name = "real";
`,
  "uses-mock.mjs": `import { name } from "./mocked.mjs";
see("uses-mock with " + name);
`,
  "calls.mjs": `globalThis.call = store.run("S", () => graph.run(() => import("./uses-mock.mjs")));
export {};
`,
  "graph.test.cjs": `const { test, expect, mock } = require("bun:test");
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.graph = new Bun.ModuleGraph();
const read = [];
const where = () => (Bun.ModuleGraph.current === graph ? "in the graph" : "in no graph");
globalThis.see = label => read.push(label + ", store " + store.getStore() + ", " + where());
test("the factory of a mock below an import() that a required module calls in the context of a module graph", async () => {
  mock.module("./mocked.mjs", () => {
    see("the factory");
    return { name: "the mock" };
  });
  require("./calls.mjs");
  await globalThis.call;
  expect(read).toEqual([
    "the factory, store undefined, in no graph",
    "uses-mock with the mock, store undefined, in no graph",
  ]);
});
`,
};
knownWrongAnswerOfCompiledRun(
  "where the factory of a mock runs inside a call of import() in the context of a module graph",
  filesOfCallInContextOfModuleGraphWhoseMocksRunAtOnce,
  "./graph.test.cjs",
);

// There a test file is a module of a Bun.ModuleGraph, and a load that begins in the context of a graph keeps no store.
test.todo("bun test --isolate=modules", () => passes("test --isolate=modules"));
