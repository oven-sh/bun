import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const attempt = `
  import { test } from "bun:test";
  const attempt = (name, run) => { try { run(); console.log(name, "no error"); } catch (e) { console.log(name, e.name, e.message); } };`;

const storesToOtherObjects = `
  attempt("Array.prototype, the same", () => { Array.prototype.__proto__ = Object.prototype; });
  attempt("Array.prototype, what it reads", () => { Array.prototype.__proto__ = Array.prototype.__proto__; });
  attempt("Array.prototype, a number", () => { Array.prototype.__proto__ = 1; });
  attempt("Math, the same", () => { Math.__proto__ = Object.prototype; });
  attempt("Math, a number", () => { Math.__proto__ = 1; });
  attempt("JSON, a number", () => { JSON.__proto__ = 1; });
  attempt("Array, the same", () => { Array.__proto__ = Function.prototype; });
  attempt("Promise.prototype, by a key that is put together", () => { Promise.prototype[["__pro", "to__"].join("")] = 1; });
  attempt("Reflect.set", () => { console.log(Reflect.set(Array.prototype, "__proto__", 1), Reflect.set(JSON, "__proto__", Object.prototype)); });`;

const files = {
  "stores-to-object-prototype-too.test.js": `${attempt}
    test("stores", () => {
      ${storesToOtherObjects}
      attempt("Object.prototype, null", () => { Object.prototype.__proto__ = null; });
      attempt("Object.prototype, a number", () => { Object.prototype.__proto__ = 1; });
    });`,
  "stores-to-other-objects-alone.test.js": `${attempt}
    test("stores", () => {
      ${storesToOtherObjects}
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
  using directory = tempDir("stores-to-proto-in-a-test-run", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("Array.prototype, the same no error");
  expect(plain.printed).not.toContain("Error");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
