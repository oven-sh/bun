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
};

const main = `
import { write } from "./write.cjs";
let said: unknown;
try { said = write(); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; }
process.stdout.write("ANSWER " + String(said) + "\\n");
`;

describe.skipIf(isWindows)("a file of the product meets in a test run what it meets in the executable", () => {
  for (const [title, body] of Object.entries(writes)) {
    test(title, async () => {
      const folder = String(
        tempDir("aot-product-writes", {
          "product/write.cjs": `exports.write = function write() {\n  ${body}\n};\n`,
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
      const executable = await answerOf(join(folder, "program"));
      expect(executable).toHaveLength(1);
      expect(await answerOf(bunExe(), "test", "--aot")).toEqual(executable);
    });
  }
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

test("code that a file of the product makes from a text meets what it meets in the executable", async () => {
  const folder = String(
    tempDir("aot-product-writes-from-text", {
      "product/write.cjs": `exports.write = new Function("Buffer.isEncoding = function () { return true; }; return Buffer.isEncoding('made-up');");\n`,
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
  const executable = await answerOf(join(folder, "program"));
  expect(executable).toHaveLength(1);
  expect(await answerOf(bunExe(), "test", "--aot")).toEqual(executable);
});
