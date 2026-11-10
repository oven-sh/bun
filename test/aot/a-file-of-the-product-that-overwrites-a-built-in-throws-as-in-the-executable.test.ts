// Built-in objects are read-only in a compiled executable. A test run opened whatever the build saw written, wherever it was written: `Buffer.isEncoding = ..` in a file of
// the product was stored under `bun test --aot` and threw in the executable, so a green suite said nothing of that line. Now a file that the executable holds too meets what
// it meets there. The files of the tests replace what they like: a test file, what lies beside it or below, a preload, and whatever takes something from the test runner.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const writes = {
  "an assignment": `Buffer.isEncoding = function () { return true; }; return Buffer.isEncoding("made-up");`,
  "an assignment to a prototype": `Buffer.prototype.toString = function () { return "patched"; }; return Buffer.from("a").toString();`,
  "a computed name": `const name = ["is", "Encoding"].join(""); Buffer[name] = () => true; return Buffer.isEncoding("made-up");`,
  "a helper that is handed the object and the name": `function patch(holder, name, value) { holder[name] = value; } patch(Buffer, "byteLength", () => 7); return Buffer.byteLength("abc");`,
  "Object.defineProperty": `Object.defineProperty(Buffer, "isEncoding", { value: () => true, configurable: true, writable: true }); return Buffer.isEncoding("made-up");`,
  "Object.assign": `Object.assign(Buffer, { isEncoding: () => true }); return Buffer.isEncoding("made-up");`,
  "Reflect.set": `return String(Reflect.set(Buffer, "isEncoding", () => true)) + " " + Buffer.isEncoding("made-up");`,
  "delete": `return String(delete Buffer.isEncoding) + " " + typeof Buffer.isEncoding;`,
  "a new name on a prototype, which an executable takes": `Array.prototype.lastOne = function () { return this[this.length - 1]; }; return [1, 2].lastOne();`,
  "several objects that meet in one place": `for (const holder of [Math, JSON]) holder[["im", "ul"].join("")] = () => 7; return Math.imul(2, 3);`,
  "what stands above a value that nobody knows": `JSON.parse("[]").__proto__.push = () => 7; return [].push(1);`,
  "a new name on several objects that meet in one place": `for (const holder of [Array.prototype, String.prototype]) holder.lastOfAll = () => 7; return typeof [].lastOfAll;`,
  "Reflect.set on several objects": `return [Math, JSON].map(holder => Reflect.set(holder, "imul", () => 7)).join() + " " + Math.imul(2, 3);`,
  "Reflect.defineProperty on several objects": `return [Math, JSON].map(holder => Reflect.defineProperty(holder, "imul", { value: () => 7 })).join() + " " + Math.imul(2, 3);`,
  "Object.defineProperties on several objects": `for (const holder of [Math, JSON]) Object.defineProperties(holder, { imul: { value: () => 7 } }); return Math.imul(2, 3);`,
  "__defineGetter__ on several objects": `for (const holder of [Math, JSON]) holder.__defineGetter__("imul", () => () => 7); return Math.imul(2, 3);`,
  "delete on several objects": `return [Math, JSON].map(holder => delete holder.imul).join() + " " + typeof Math.imul;`,
  "a static block": `class Patch { static { for (const holder of [Math, JSON]) holder.imul = () => 7; } } return String(Patch.name) + Math.imul(2, 3);`,
  "a proxy over several objects": `for (const holder of [Math, JSON]) new Proxy(holder, {}).imul = () => 7; return Math.imul(2, 3);`,
  "__proto__ of several objects": `for (const holder of [Array.prototype, String.prototype]) holder.__proto__ = { marked: 7 }; return [].marked;`,
  "Object.setPrototypeOf on several objects": `for (const holder of [Array.prototype, String.prototype]) Object.setPrototypeOf(holder, { marked: 7 }); return [].marked;`,
  "a borrowed setter": `const { set } = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__"); for (const holder of [Array.prototype, String.prototype]) set.call(holder, { marked: 7 }); return [].marked;`,
};

// Made from a text: the build compiles a constant text as a file of its own, whose path lies in no folder. It goes by the file that holds it.
const fromText = "code that a file of the product makes from a text";
const filesOfProduct = [
  ...Object.entries(writes).map(([title, body]) => [title, `exports.write = function write() {\n  ${body}\n};\n`]),
  [
    fromText,
    `exports.write = new Function("Buffer.isEncoding = function () { return true; }; return Buffer.isEncoding('made-up');");\n`,
  ],
];

// One product for all of them, a file to each write: whether a file finds the built-ins read-only is a fact of that file. Each says what it met under its own number.
const main = `
${filesOfProduct.map((_, index) => `import { write as write${index} } from "./write-${index}.cjs";`).join("\n")}
[${filesOfProduct.map((_, index) => `write${index}`).join(", ")}].forEach((write, index) => {
  let said: unknown;
  try { said = write(); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; }
  process.stdout.write("ANSWER " + index + " " + String(said) + "\\n");
});
`;

describe.skipIf(isWindows)("a file of the product meets in a test run what it meets in the executable", () => {
  let answers: Promise<{ executable: string[]; testRun: string[] }> | undefined;
  const ask = () =>
    (answers ??= (async () => {
      const folder = String(
        tempDir("aot-product-writes", {
          ...Object.fromEntries(filesOfProduct.map(([, text], index) => [`product/write-${index}.cjs`, text])),
          "product/main.ts": main,
          "entry.ts": `import "./product/main.ts";\n`,
          "tests/entry.test.ts": `import { test } from "bun:test";\nimport "../product/main.ts";\ntest("runs", () => {});\n`,
        }),
      );
      const answerOf = async (...cmd: string[]) => {
        await using child = Bun.spawn({ cmd, cwd: folder, env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        expect({ err: exitCode ? err : "", exitCode }).toEqual({ err: "", exitCode: 0 });
        return out.split("\n").filter(line => line.startsWith("ANSWER"));
      };
      await answerOf(bunExe(), "build", "--compile", "--aot", "./entry.ts", "--outfile", "program");
      return {
        executable: await answerOf(join(folder, "program")),
        testRun: await answerOf(bunExe(), "test", "--aot"),
      };
    })());
  filesOfProduct.forEach(([title], index) => {
    test(title, async () => {
      const { executable, testRun } = await ask();
      const of = (lines: string[]) => lines.filter(line => line.startsWith(`ANSWER ${index} `));
      expect(of(executable)).toHaveLength(1);
      expect(of(testRun)).toEqual(of(executable));
    });
  });
});

const reads = {
  "product/reads.ts": `export const answers = () => [Buffer.isEncoding("made-up"), Buffer.byteLength("abc"), Date.now() === 5, Math.random()].join();`,
};

test("a test file replaces what it likes", async () => {
  await expectCompiledToRunAsPlain({
    ...reads,
    "tests/one.test.ts": `
import { spyOn, test } from "bun:test";
import { answers } from "../product/reads";
test("replaces", () => {
  const kept = [Buffer.isEncoding, Math.random] as const;
  Buffer.isEncoding = () => true;
  Math.random = () => 0.5;
  const spies = [spyOn(Buffer, "byteLength").mockReturnValue(7), spyOn(Date, "now").mockReturnValue(5)];
  console.log(answers());
  for (const spy of spies) spy.mockRestore();
  [Buffer.isEncoding, Math.random] = kept;
  console.log(Buffer.isEncoding("made-up"), Buffer.byteLength("abc"));
});`,
  });
});

test("so does a helper beside the tests, and one that lies elsewhere and takes something from the test runner", async () => {
  await expectCompiledToRunAsPlain({
    ...reads,
    "tests/helper.ts": `export function patch() { const kept = Buffer.isEncoding; Buffer.isEncoding = () => true; return () => { Buffer.isEncoding = kept; }; }`,
    "product/testing/stubs.ts": `
import { spyOn } from "bun:test";
export function stub() {
  const kept = Math.random;
  Math.random = () => 0.5;
  const spy = spyOn(Buffer, "byteLength").mockReturnValue(7);
  return () => { Math.random = kept; spy.mockRestore(); };
}`,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { answers } from "../product/reads";
import { stub } from "../product/testing/stubs";
import { patch } from "./helper";
test("replaces", () => {
  const undo = [patch(), stub()];
  console.log(answers().replace(/^(.*,.*),.*,(.*)$/, "$1,$2"));
  for (const each of undo) each();
  console.log(Buffer.isEncoding("made-up"), Buffer.byteLength("abc"));
});`,
  });
});

test("what a file of the product is refused out of sight is listed when the run ends, thrown or not", async () => {
  using dir = tempDir("aot-product-writes-listed", {
    "package.json": `{ "name": "made-up", "main": "product/main.ts" }`,
    "product/main.ts": `
export function patchAll() {
  const said: unknown[] = [];
  for (const holder of [Math, JSON] as any[]) {
    try { holder.imul = () => 7; said.push("stored"); } catch (error) { said.push((error as Error).name); }
    said.push(Reflect.set(holder, "hypot", () => 7));
  }
  return said.join() + " " + Math.imul(2, 3) + " " + Math.hypot(3, 4);
}`,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { patchAll } from "../product/main";
test("patches", () => { console.log(patchAll()); });`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect(out).toContain("TypeError,false,");
  expect(out).toContain(" 6 5\n");
  expect(err).toContain("Cannot assign to Math.imul, at product/main.ts:");
  expect(err).toContain("Cannot assign to Math.hypot, at product/main.ts:");
  expect(err).toContain("while tests/one.test.ts ran");
  expect(exitCode).toBe(0);
});

// Whose a file is does not hang on which other test files run: a store that stands in a file of the program is refused also where a test calls it to patch a built-in that it climbed to.
test("a test that patches through a function of the product meets the same alone and beside a test file that imports the entry point", async () => {
  using dir = tempDir("aot-product-writes-in-company", {
    "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
    "src/main.js": `import { patch } from "./patch.js";\nexport const keep = patch;\n`,
    "src/patch.js": `export function patch(holder, name, value) { holder[name] = value; }\n`,
    "a.test.js": `
import { test } from "bun:test";
import { patch } from "./src/patch.js";
test("a", () => {
  let said;
  try { patch(Object.getPrototypeOf([]), "push", () => 7); patch(Object.getPrototypeOf(new Map()), "get", () => 7); said = "stored"; } catch (error) { said = error.name; }
  console.log("SAID", said, [].push(1));
});`,
    "b.test.js": `import { test } from "bun:test";\nimport "./src/main.js";\ntest("b", () => {});\n`,
  });
  const said = async (...files: string[]) => {
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...files],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
    return { said: out.split("\n").filter(line => line.startsWith("SAID")), exitCode };
  };
  const alone = await said("./a.test.js");
  expect(alone).toEqual({ said: ["SAID TypeError 1"], exitCode: 0 });
  expect(await said()).toEqual(alone);
});

// The lock asked about the member alone: a member that some test file had opened took the store of the product too.
test("nor does it hang on what the other test files replace, in sight or out of it", async () => {
  using dir = tempDir("aot-product-writes-beside-what-tests-replace", {
    "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
    "src/main.js": `
import { patch } from "./patch.js";
export const keep = patch;
export function patchSpelled() { Array.prototype.push = () => 7; }
export function pushOne() { return [].push(1); }
`,
    "src/patch.js": `export function patch(holder, name, value) { holder[name] = value; }\n`,
    "a.test.js": `
import { test } from "bun:test";
import { patchSpelled } from "./src/main.js";
import { patch } from "./src/patch.js";
test("a", () => {
  const said = [];
  for (const write of [() => patch(Object.getPrototypeOf([]), "push", () => 7), patchSpelled]) {
    try { write(); said.push("stored"); } catch (error) { said.push(error.name); }
  }
  console.log("SAID", said.join(), [].push(1));
});`,
    "c.test.js": `
import { test } from "bun:test";
test("c", () => {
  for (const holder of [Object.getPrototypeOf([]), Object.getPrototypeOf(new Map())]) holder["k" + Date.now()] = 1;
  const kept = [].push;
  for (const holder of [Object.getPrototypeOf([]), Object.getPrototypeOf(new Map())]) holder[["pu", "sh"].join("")] = () => 9;
  console.log("TESTS", [].push(1));
  Object.getPrototypeOf([])[["pu", "sh"].join("")] = kept;
});`,
    "d.test.js": `
import { spyOn, test } from "bun:test";
import { pushOne } from "./src/main.js";
test("d", () => {
  const spy = spyOn(Array.prototype, "push").mockReturnValue(5);
  console.log("SPY", pushOne(), spy.mock.calls.length);
  spy.mockRestore();
  console.log("SPY", pushOne());
});`,
  });
  const said = async (...files: string[]) => {
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...files],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
    return { said: out.split("\n").filter(line => /^(SAID|TESTS|SPY) /.test(line)), exitCode };
  };
  const ofProduct = "SAID TypeError,TypeError 1";
  expect(await said("./a.test.js")).toEqual({ said: [ofProduct], exitCode: 0 });
  expect(await said("./a.test.js", "./c.test.js")).toEqual({ said: [ofProduct, "TESTS 9"], exitCode: 0 });
  expect(await said("./a.test.js", "./d.test.js")).toEqual({ said: [ofProduct, "SPY 5 1", "SPY 1"], exitCode: 0 });
});

// The caches of stores are one table for the whole run: what a test file had stored was remembered, and the product's store was answered out of the table.
test("nor on what a test has stored before", async () => {
  using dir = tempDir("aot-product-writes-behind-a-store-of-the-test", {
    "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
    "src/main.js": `import { patch } from "./patch.js";\nexport const keep = patch;\n`,
    "src/patch.js": `
export function patch(holder, name, value) { holder[name] = value; }
export function remove(holder, name) { return delete holder[name]; }
export function setGlobal(value) { fetch = value; }
`,
    "a.test.js": `
import { test } from "bun:test";
import { patch, remove, setGlobal } from "./src/patch.js";
const tryIt = write => { try { write(); return "stored"; } catch (error) { return error.name; } };
test("a", () => {
  const said = [tryIt(() => patch(Math, "imul", () => 7))];
  for (let i = 0; i < 300; i++) Math.imul = () => 9;
  for (let i = 0; i < 300; i++) said[1] = tryIt(() => patch(Math, "imul", () => 7));
  for (let i = 0; i < 300; i++) fetch = () => 9;
  for (let i = 0; i < 300; i++) said[2] = tryIt(() => setGlobal(() => 7));
  const kept = Math.hypot;
  for (let i = 0; i < 300; i++) { delete Math.hypot; Math.hypot = kept; }
  for (let i = 0; i < 300; i++) said[3] = tryIt(() => remove(Math, "hypot"));
  console.log("SAID", said.join(), Math.imul(2, 3), fetch(), Math.hypot(3, 4));
});`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  expect({ said: out.split("\n").filter(line => line.startsWith("SAID")), exitCode }).toEqual({
    said: ["SAID TypeError,TypeError,stored,TypeError 9 7 5"],
    exitCode: 0,
  });
});

// Who writes was asked of the frames that a stack trace shows, and a trace leaves out a frame whose call stands last. That went wrong both ways: the product's native store was taken
// for the tests', and the tests' own (the lines OWN), made in a function that the product calls, was refused, by Reflect.set without a word. And Object.prototype, the one holder that is
// locked as a whole, was passed over.
test("nor on the kind of store, on the holder, or on whether the native function that stores is called last", async () => {
  using dir = tempDir("aot-product-writes-of-every-kind", {
    "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
    "src/main.js": `
const descriptor = value => ({ value, writable: true, configurable: true });
export function patchToString() { Object.prototype.toString = () => "patched"; }
export function defineAndStay(holder, name, value) { Object.defineProperty(holder, name, descriptor(value)); }
export const define = (holder, name, value) => Object.defineProperty(holder, name, descriptor(value));
export const set = (holder, name, value) => Reflect.set(holder, name, value);
export const remove = (holder, name) => delete holder[name];
export function run(work) { const result = work(); return [result][0]; }
`,
    "a.test.js": `
import { test } from "bun:test";
test("a", () => {
  const kept = [Object.prototype.toString, Array.prototype.at, Math.trunc];
  Object.prototype.toString = () => "tests";
  Array.prototype.at = () => 9;
  Math.trunc = () => 9;
  console.log("TESTS", String({}), [5].at(0), Math.trunc(1.5));
  [Object.prototype.toString, Array.prototype.at, Math.trunc] = kept;
});
`,
    "b.test.js": `
import { test } from "bun:test";
import { define, defineAndStay, patchToString, remove, run, set } from "./src/main.js";
const tryIt = write => { try { return String(write() ?? "stored"); } catch (error) { return error.name; } };
test("b", () => {
  const said = [
    tryIt(() => patchToString()),
    tryIt(() => { defineAndStay(Array.prototype, "at", () => 7); }),
    tryIt(() => { define(Array.prototype, "at", () => 7); }),
    tryIt(() => set(Math, "trunc", () => 7)),
    tryIt(() => remove(Math, "trunc")),
  ];
  console.log("SAID", said.join(), String({}), [5].at(0), Math.trunc(1.5));
  const kept = Math.trunc;
  for (const write of [() => { Object.assign(Math, { trunc: () => 8 }); }, () => Object.assign(Math, { trunc: () => 8 }), () => Reflect.set(Math, "trunc", () => 8)]) {
    console.log("OWN", tryIt(() => { run(write); }), Math.trunc(1.5));
    Math.trunc = kept;
  }
});
`,
  });
  const said = async (...files: string[]) => {
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...files],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
    return { said: out.split("\n").filter(line => /^(SAID|TESTS|OWN) /.test(line)), exitCode };
  };
  const ofSecondFile = [
    "SAID TypeError,TypeError,TypeError,false,TypeError [object Object] 5 1",
    "OWN stored 8",
    "OWN stored 8",
    "OWN stored 8",
  ];
  expect(await said("./b.test.js")).toEqual({ said: ofSecondFile, exitCode: 0 });
  expect(await said("./a.test.js", "./b.test.js")).toEqual({ said: ["TESTS tests 9 9", ...ofSecondFile], exitCode: 0 });
});

for (const [title, { product, tests, said }] of Object.entries({
  // A seventh place remembered a store and asked nothing: "an own accessor at this offset", filed for the whole run.
  "an accessor that a test has laid and stored through": {
    product: `
export function patchFloor() { Math.floor = () => 7; }`,
    tests: `
import { test } from "bun:test";
import { patchFloor } from "./src/main.js";
const tryIt = write => { try { write(); return "stored"; } catch (error) { return error.name; } };
test("a", () => {
  const kept = Math.floor;
  let taken = 0;
  Object.defineProperty(Math, "floor", { get: () => kept, set: () => { taken++; }, configurable: true });
  const said = [tryIt(patchFloor)];
  for (let i = 0; i < 300; i++) Math.floor = 1;
  const before = taken;
  for (let i = 0; i < 300; i++) said[1] = tryIt(patchFloor);
  console.log("SAID", said.join(), taken - before);
  Object.defineProperty(Math, "floor", { value: kept, writable: true, configurable: true });
});`,
    said: "SAID TypeError,TypeError 0",
  },
  // The two places that remember a store to a global.
  "what a test has stored on the global object, through it or by the name": {
    product: `
export function throughGlobalThis(other) { globalThis.Math = other; }
export function byName(other) { Math = other; }`,
    tests: `
import { test } from "bun:test";
import { byName, throughGlobalThis } from "./src/main.js";
const tryIt = write => { try { write(); return "stored"; } catch (error) { return error.name; } };
test("a", () => {
  const kept = Math, said = [];
  for (let i = 0; i < 300; i++) { globalThis.Math = { i }; globalThis.Math = kept; }
  for (let i = 0; i < 300; i++) said[0] = tryIt(() => throughGlobalThis({}));
  globalThis.Math = kept;
  for (let i = 0; i < 300; i++) { Math = { i }; Math = kept; }
  for (let i = 0; i < 300; i++) said[1] = tryIt(() => byName({}));
  Math = kept;
  console.log("SAID", said.join(), Math === kept);
});`,
    said: "SAID TypeError,TypeError true",
  },
  // Behind two native frames nobody was asked. The last pair is the tests' own store, called last in a function that the product calls.
  "how many native functions stand between the store and the file that has it made": {
    product: `
const descriptor = value => ({ value, writable: true, configurable: true });
export function byReplace() { "x".replace("x", Object.assign.bind(null, Math, { trunc: () => 7 }, null)); }
export const byReplaceLast = () => "x".replace("x", Object.assign.bind(null, Math, { trunc: () => 7 }, null));
export function byToJSON() { JSON.stringify({ toJSON: Reflect.defineProperty.bind(null, Math, "trunc", descriptor(() => 7)) }); }
export const byToJSONLast = () => JSON.stringify({ toJSON: Reflect.defineProperty.bind(null, Math, "trunc", descriptor(() => 7)) });
export function run(work) { const result = work(); return [result][0]; }`,
    tests: `
import { test } from "bun:test";
import { byReplace, byReplaceLast, byToJSON, byToJSONLast, run } from "./src/main.js";
test("a", () => {
  const kept = Math.trunc, said = [];
  Math.trunc = () => 9;
  const own = () => "x".replace("x", Object.assign.bind(null, Math, { trunc: () => 8 }, null));
  for (const patch of [byReplace, byReplaceLast, byToJSON, byToJSONLast, () => { run(own); }]) {
    Math.trunc = kept;
    try { patch(); said.push("returned"); } catch (error) { said.push(error.name); }
    said.push(Math.trunc(1.5));
  }
  Math.trunc = kept;
  console.log("SAID", said.join());
});`,
    said: "SAID TypeError,1,TypeError,1,returned,1,returned,1,returned,8",
  },
  // A name that the product spells above all objects was opened by that very spelling, for the product too. An executable opens none there.
  "who has opened a name above all objects: what the product spells there it does not open for itself": {
    product: `
export function spelled() { Object.prototype.toJSON = () => "product"; }
export function remove(name) { for (const holder of [Object.prototype]) delete holder[name]; }`,
    tests: `
import { test } from "bun:test";
import { remove, spelled } from "./src/main.js";
test("b", () => {
  let said;
  try { spelled(); said = "stored"; } catch (error) { said = error.name; }
  console.log("SAID", said, JSON.stringify({ a: 1 }));
  try { remove(["to", "JSON"].join("")); } catch {}
});`,
    said: 'SAID TypeError {"a":1}',
  },
  // Named on the page, held to its word, the mirror image of the row below: THE TESTS' OWN STORE IS REFUSED (the first and the fifth word) where the function of the tests has left by calling a
  // native function that it holds in a variable, and a function of the product stands below. In brackets the arrow function stays. The end of the run lists the refusal.
  "anything but this: a function of the tests that has left when its native function stores, above a function of the product":
    {
      product: `export function run(work) { const result = work(); return [result][0]; }`,
      tests: `
import { test } from "bun:test";
import { run } from "./src/main.js";
test("t", () => {
  const kept = Math.ceil, said = [], set = Reflect.set.bind(null, Math, "ceil"), assign = Object.assign.bind(null, Math);
  Math.ceil = () => 9; Math.ceil = kept;
  for (const own of [() => set(() => 8), () => [set(() => 8)], () => assign({ ceil: () => 8 }), () => [assign({ ceil: () => 8 })]]) {
    try { said.push(String(run(own))); } catch (error) { said.push(error.name); }
    said.push(Math.ceil(1.5)); Math.ceil = kept;
  }
  console.log("SAID", said.join());
});`,
      said: "SAID false,2,true,8,TypeError,2,[object Math],8",
    },
  // A text belongs to the file that hands it to node:vm, as one handed to eval does, whoever has it run and in whichever context.
  "who has a text run that was handed to node:vm": {
    product: `
import vm from "node:vm";
const text = "Math.ceil = () => 7";
export const roads = [
  () => { vm.runInThisContext(text); },
  () => { new vm.Script(text).runInThisContext(); },
  () => { vm.compileFunction(text)(); },
  () => { vm.runInNewContext("M.ceil = () => 7", { M: Math }); },
  () => { vm.runInThisContext("eval('Math.ceil = () => 7')"); },
];
export const made = new vm.Script(text);
export function run(script) { script.runInThisContext(); }`,
    tests: `
import { test } from "bun:test";
import vm from "node:vm";
import { made, roads, run } from "./src/main.js";
test("a", () => {
  const kept = Math.ceil, said = [];
  Math.ceil = () => 9;
  const own = "Math.ceil = () => 8";
  for (const patch of [...roads, () => made.runInThisContext(), () => run(new vm.Script(own)), () => vm.runInThisContext(own)]) {
    Math.ceil = kept;
    try { patch(); said.push(Math.ceil(1.5)); } catch (error) { said.push(error.constructor.name + Math.ceil(1.5)); }
  }
  Math.ceil = kept;
  console.log("SAID", said.join());
});`,
    said: "SAID TypeError2,TypeError2,TypeError2,TypeError2,TypeError2,TypeError2,8,8",
  },
  // What docs/compiler/debugging.mdx names as still taken, held to its word: the first stays on the stack and is refused; of the next two nothing is running when the store happens; of the
  // last two nothing is running when node:vm is handed the text: one has left, so the text is the test's that called it, the other is a timer's. Whoever mends one of them changes the page
  // with this line.
  "anything but this: nothing of the product is running when the store happens, or when node:vm is handed the text": {
    product: `
import vm from "node:vm";
const set = Reflect.set.bind(null, Math, "ceil");
export function patchAndStay() { return [set(() => 7)]; }
export function patchLast() { return set(() => 7); }
export function patchLater() { setTimeout(Object.assign, 0, Math, { ceil: () => 7 }); }
export function patchByTextLast() { return vm.runInThisContext("Math.ceil = () => 7"); }
export function patchByTextLater() { setTimeout(vm.runInThisContext, 0, "Math.ceil = () => 7"); }`,
    tests: `
import { test } from "bun:test";
import { patchAndStay, patchByTextLast, patchByTextLater, patchLast, patchLater } from "./src/main.js";
test("a", async () => {
  const kept = Math.ceil, said = [];
  Math.ceil = () => 9;
  for (const patch of [patchAndStay, patchLast, patchLater, patchByTextLast, patchByTextLater]) {
    Math.ceil = kept;
    patch();
    await new Promise(done => setTimeout(done, 5));
    said.push(Math.ceil(1.5));
  }
  Math.ceil = kept;
  console.log("SAID", said.join());
});`,
    said: "SAID 2,7,7,7,7",
  },
})) {
  test(`nor on ${title}`, async () => {
    using dir = tempDir("aot-product-writes-whoever-stored-before", {
      "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
      "src/main.js": product,
      "a.test.js": tests,
    });
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
    expect({ said: out.split("\n").filter(line => line.startsWith("SAID")), exitCode }).toEqual({
      said: [said],
      exitCode: 0,
    });
  });
}

// What a run opens for the tests is of three kinds: a member that an executable always locks, a name that is no member, and a member that an executable locks while nobody writes it.
for (const [title, { product, first, second, alone, inCompany }] of Object.entries({
  "a name that is no member, which another test file adds above all objects": {
    product: `
export function run(work) { const result = work(); return [result][0]; }
export function add(name, value) { for (const holder of [Object.prototype]) holder[name] = value; }
export function remove(name) { for (const holder of [Object.prototype]) delete holder[name]; }`,
    first: `
import { test } from "bun:test";
test("a", () => {
  const kept = Object.prototype.toString;
  Object.prototype.toJSON = () => "tests"; Object.prototype.toString = () => "tests";
  console.log("TESTS", JSON.stringify({ a: 1 }), String({}));
  delete Object.prototype.toJSON; Object.prototype.toString = kept;
});`,
    second: `
import { test } from "bun:test";
import { add, remove } from "./src/main.js";
test("b", () => {
  const said = [["to", "JSON"], ["to", "String"]].map(parts => {
    try { add(parts.join(""), () => "product"); return "stored"; } catch (error) { return error.name; }
  });
  said.push(JSON.stringify({ a: 1 }));
  try { remove(["to", "JSON"].join("")); } catch {}
  console.log("SAID", said.join());
});`,
    alone: ['SAID TypeError,TypeError,{"a":1}'],
    inCompany: ['TESTS "tests" tests', 'SAID TypeError,TypeError,{"a":1}'],
  },
  // Named on the page, held to its word: ALONE AND IN COMPANY DIFFER HERE. The executable says what the run alone says. The third kind is not judged by who writes, nor is a new name on a holder
  // on which an executable opens what the program spells: the run time cannot tell who spelled it. Whoever mends one of them changes the page with this row.
  "anything but this: a method that an executable can replace too, or a new name on Function.prototype, which another test file replaces or adds":
    {
      product: `
function put(sample, name, value) { Object.getPrototypeOf(sample)[name] = value; }
export function tell() {
  const said = [];
  for (const [sample, parts, read] of [
    [() => 1, ["to", "String"], () => String(() => 1)],
    [() => 1, ["ex", "tra"], () => (() => 1).extra?.()],
  ]) {
    try { put(sample, parts.join(""), () => "product"); said.push("stored"); } catch (error) { said.push(error.name); }
    said.push(String(read()));
  }
  return said.join();
}`,
      first: `
import { test } from "bun:test";
test("a", () => {
  const kept = Function.prototype.toString;
  Function.prototype.toString = () => "tests"; Function.prototype.extra = () => "tests";
  console.log("TESTS", String(() => 1), (() => 1).extra());
  Function.prototype.toString = kept; delete Function.prototype.extra;
});`,
      second: `
import { test } from "bun:test";
import { tell } from "./src/main.js";
test("b", () => { console.log("SAID", tell()); });`,
      alone: ["SAID TypeError,() => 1,TypeError,undefined"],
      inCompany: ["TESTS tests tests", "SAID stored,product,stored,product"],
    },
})) {
  test(`nor on ${title}`, async () => {
    using dir = tempDir("aot-product-writes-under-names-that-the-tests-open", {
      "package.json": `{ "name": "made-up", "main": "src/main.js" }`,
      "src/main.js": product,
      "a.test.js": first,
      "b.test.js": second,
    });
    const said = async (...files: string[]) => {
      await using child = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", ...files],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      return { said: out.split("\n").filter(line => /^(SAID|TESTS) /.test(line)), exitCode };
    };
    expect(await said("./b.test.js")).toEqual({ said: alone, exitCode: 0 });
    expect(await said("./a.test.js", "./b.test.js")).toEqual({ said: inCompany, exitCode: 0 });
  });
}

// No executable holds a file that only the tests come to, however deep it lies and though it spells no built-in.
for (const [title, put] of Object.entries({
  "an assignment": `holder[name] = value;`,
  "Reflect.set": `Reflect.set(holder, name, value);`,
})) {
  test(`so does a helper two steps below a test file, which climbs to the object and is told the name: ${title}`, async () => {
    await expectCompiledToRunAsPlain({
      "package.json": `{ "name": "made-up", "main": "product/main.ts" }`,
      "product/main.ts": `export const readAll = () => new Headers({ a: "1" }).get("a") + " " + new URLSearchParams("a=1").get("a");`,
      "tests/support/count.ts": `
import { wrapAbove } from "./wrap-above";
export function countCalls(samples: object[], name: string) {
  const counted = { calls: 0, undo() {} };
  const undo = samples.map(sample => wrapAbove(sample, name, () => { counted.calls++; }));
  counted.undo = () => undo.forEach(each => each());
  return counted;
}`,
      "tests/support/wrap-above.ts": `
export function wrapAbove(sample: any, name: string, before: () => void) {
  const holder = Object.getPrototypeOf(sample);
  const kept = holder[name];
  const put = (value: unknown) => { ${put} };
  put(function (this: unknown, ...rest: unknown[]) { before(); return kept.apply(this, rest); });
  return () => put(kept);
}`,
      "tests/one.test.ts": `
import { test } from "bun:test";
import { readAll } from "../product/main";
import { countCalls } from "./support/count";
test("counts", () => {
  const counted = countCalls([new Headers(), new URLSearchParams()], "get");
  console.log(readAll(), counted.calls);
  counted.undo();
  console.log(readAll(), counted.calls);
});`,
    });
  });
}

test("so do helpers of the tests that import each other", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "name": "made-up", "main": "product/main.ts" }`,
    "product/main.ts": `export const readAll = () => new Headers({ a: "1" }).get("a") + " " + new URLSearchParams("a=1").get("a");`,
    "tests/support/wrap.ts": `
import { note } from "./log";
export function wrapAbove(sample: any, name: string, before: () => void) {
  const holder = Object.getPrototypeOf(sample);
  const kept = holder[name];
  holder[name] = function (this: unknown, ...rest: unknown[]) { before(); note(name); return kept.apply(this, rest); };
  return () => { holder[name] = kept; };
}`,
    "tests/support/log.ts": `
import { wrapAbove } from "./wrap";
export const seen: string[] = [];
export const note = (name: string) => { seen.push(name); };
export const again = () => wrapAbove;`,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { readAll } from "../product/main";
import { wrapAbove } from "./support/wrap";
test("counts", () => {
  let calls = 0;
  const undo = [new Headers(), new URLSearchParams()].map(sample => wrapAbove(sample, "get", () => { calls++; }));
  console.log(readAll(), calls);
  undo.forEach(each => each());
});`,
  });
});

// The build compiles a constant text as a file of its own, whose path lies in no folder. It goes by the file that holds it.
test("code that a file of the tests, or a package that helps them, makes from a text replaces what it likes too", async () => {
  await expectCompiledToRunAsPlain({
    ...reads,
    "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/patches/index.js": `exports.patch = new Function("fake", "const kept = Math.random; Math.random = fake; return () => { Math.random = kept; };");`,
    "product/testing/stubs.ts": `
import { mock } from "bun:test";
export const stub = mock(new Function("fake", "const kept = Buffer.byteLength; Buffer.byteLength = fake; return () => { Buffer.byteLength = kept; };"));`,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { patch } from "patches";
import { answers } from "../product/reads";
import { stub } from "../product/testing/stubs";
test("replaces", () => {
  const replace = new Function("fake", "const kept = Buffer.isEncoding; Buffer.isEncoding = fake; return () => { Buffer.isEncoding = kept; };");
  const undo = [replace(() => true), stub(() => 7), patch(() => 0.5)];
  console.log(answers().replace(/^(.*,.*),.*,(.*)$/, "$1,$2"));
  for (const each of undo) each();
  console.log(Buffer.isEncoding("made-up"), Buffer.byteLength("abc"));
});`,
  });
});
