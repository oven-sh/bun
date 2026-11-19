// A test run lists its files in require.cache. Their exports are compiled for the code that imports them unless the build sees a reader of the cache: a reader that the build cannot see used to get
// a module without names, or functions that were compiled for other arguments. It is told so, as whoever takes a file out of the cache unseen is.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const refusal = `Cannot read the entry of '/lib.mjs' in require.cache: the build saw no code that reads the cache, so the module has no entry. Write the read out in a file that the tests import: require.cache[require.resolve("./module")]`;
const asks = `"path", "return import('node:module').then(m => m.default._cache[path].exports)"`;
const project = {
  "package.json": `{ "name": "made-up-product", "version": "1.0.0", "type": "module", "main": "./product.mjs" }`,
  "app.mjs": `import { total } from "./product.mjs";\nconsole.log(total());\n`,
  "lib.mjs": `export function sum(a, b) { return a + b; }\nexport function spare(a) { return a + a; }\n`,
};
const product = (rest: string) => `import { sum } from "./lib.mjs";\nexport const total = () => sum(1, 2);\n${rest}\n`;
const testFile = (peek: string) => `
  import { test } from "bun:test";
  import * as product from "./product.mjs";
  const peek = ${peek};
  test("asks", async () => {
    let said = String(product.total());
    try {
      const got = await peek(import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs");
      said += " " + [typeof got.sum, typeof got.spare, Object.keys(got).length].join(" ");
    } catch (error) { said += " " + error.message; }
    console.log(said.replaceAll(import.meta.dir, "").replaceAll("\\\\", "/"));
  });`;

const readers: Record<string, [product: string, peek: string]> = {
  "a text that a file of the product evaluates": [
    product(`export const peek = path => new Function(${asks})(path);`),
    "product.peek",
  ],
  "the same where a site of the program hands the module out": [
    product(
      `export const never = () => import("./lib.mjs");\nexport const peek = path => new Function(${asks})(path);`,
    ),
    "product.peek",
  ],
  "a text for the constructor of a function that is out of sight": [
    product(""),
    `path => [() => 1][JSON.parse("0")].constructor(${asks})(path)`,
  ],
};

describe("a reader of require.cache that the build cannot see is refused", () => {
  test.each(Object.entries(readers))("%s", async (_, [productText, peek]) => {
    using dir = tempDir("unseen-reader-of-require-cache", {
      ...project,
      "product.mjs": productText,
      "one.test.mjs": testFile(peek),
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    expect({ stdout: stdout.split("\n").slice(1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stdout: [`3 ${refusal}`, ""],
      stderr: "",
      exitCode: 0,
    });
  });
});

const spelled: Record<string, [product: string, peek: string]> = {
  "the reader that spells it": [product(""), "path => require.cache[path].exports"],
  "and a text that a file of the product evaluates in the same run": [
    product(`export const peek = path => new Function(${asks})(path);`),
    "path => (typeof require.cache, product.peek(path))",
  ],
  "a file that the test writes and loads": [
    product(""),
    `(() => {
      const written = import.meta.dir + "/written.cjs";
      require("node:fs").writeFileSync(written, "module.exports = path => require" + ".cache[path].exports;");
      return require(written);
    })()`,
  ],
};

describe("where a compiled file spells the cache, or a load by a computed path may reach the file, the reader gets the entry", () => {
  test.each(Object.entries(spelled))("%s", async (_, [productText, peek]) => {
    using dir = tempDir("spelled-reader-of-require-cache", {
      ...project,
      "product.mjs": productText,
      "one.test.mjs": testFile(peek),
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    expect({ stdout: stdout.split("\n").slice(1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stdout: ["3 function function 2", ""],
      stderr: "",
      exitCode: 0,
    });
  });
});
