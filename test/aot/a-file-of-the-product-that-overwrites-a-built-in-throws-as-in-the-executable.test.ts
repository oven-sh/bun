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
