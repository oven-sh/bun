// `import * as util from "./util.js"; util.captureStackTrace(error)`, where nobody knows what the export holds (zod: `"captureStackTrace" in Error ? Error.captureStackTrace : ..`):
// the namespace object is the `this` of a call of a value that nobody knows. A test run took that value for a spy, or for code that finds one, as soon as some package evaluated
// text: every export of the file counted as replaceable, each call through one of them was again such a call, and the build started over until no file was added: four rounds for
// a koa server, a fifth of whose functions then differed from the executable's. No test had a spy.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

// The tests stand in a folder of their own: what lies beside a test file or below it is theirs.
const product = {
  "product/util.mjs": `
export const capture = globalThis[["structured", "Clone"].join("")];
export const LIMIT = 4;
export function helper(value) { return value + 1; }
export function other(value) { return helper(value) * LIMIT; }
`,
  "product/parse.mjs": `
import * as util from "./util.mjs";
export function parse(value) { return [util.capture({ value }).value, util.helper(value), util.other(value), util.LIMIT].join(); }
`,
  "product/evaluates.cjs": `exports.made = Function("return " + process.argv.length)();`,
  "product/main.ts": `
import { parse } from "./parse.mjs";
import { made } from "./evaluates.cjs";
console.log(parse(1), typeof made);
`,
  // The file that a program begins at is called by the host, so it has a form of its own.
  "entry.ts": `import "./product/main.ts";\n`,
};

const files = Object.keys(product).flatMap(name => (name.startsWith("product/") ? [name.slice("product".length)] : []));

/** `file:position name form bytes` of each function written below product/. */
function functionsOfProduct(mapPath: string): string[] {
  const rows = readFileSync(mapPath, "latin1").split("\n");
  const functions = rows.map(row => row.split("\t")).filter(columns => columns[0] === "F");
  return functions
    .flatMap(columns => {
      const file = files.find(name => (columns[10] ?? "").endsWith(name));
      return file ? [`${file}:${columns[11]} ${columns[7]} ${columns[8]} ${columns[3]}`] : [];
    })
    .sort();
}

describe.skipIf(isWindows)("a test run compiles what the executable compiles", () => {
  test("though a call through a namespace object reaches an export that nobody knows", async () => {
    const folder = String(
      tempDir("aot-no-spy", {
        ...product,
        "tests/entry.test.ts": `import { test } from "bun:test";\nimport "../product/main.ts";\ntest("runs", () => {});\n`,
      }),
    );
    const build = async (map: string, ...command: string[]) => {
      await using child = Bun.spawn({
        cmd: [bunExe(), ...command],
        cwd: folder,
        env: { ...bunEnv, [buildEnvironment.mapFilePath]: join(folder, map) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ out, err, exitCode }).toEqual({ out: expect.any(String), err: expect.any(String), exitCode: 0 });
      return functionsOfProduct(join(folder, map));
    };
    const executable = await build(
      "executable.map",
      "build",
      "--compile",
      "--aot",
      "./entry.ts",
      "--outfile",
      "program",
    );
    const testRun = await build("test-run.map", "test", "--aot", "./tests/entry.test.ts");
    expect(executable).not.toBeEmpty();
    expect(testRun).toEqual(executable);
  });
});

const spied = {
  "product/lib.mjs": `export function add(a, b) { return a + b; }\nexport function twice(n) { return add(n, n); }\n`,
  "product/uses.mjs": `import * as lib from "./lib.mjs";\nimport { add } from "./lib.mjs";\nexport const byName = () => add(1, 2);\nexport const byNamespace = () => lib.add(1, 2);\nexport function apply(callee, ...operands) { return callee(...operands); }\n`,
};
const head = `import { expect, spyOn, test } from "bun:test";\nimport * as lib from "../product/lib.mjs";\nimport { apply, byName, byNamespace } from "../product/uses.mjs";\n`;

test("text that a test file evaluates still finds its spy", async () => {
  await expectCompiledToRunAsPlain({
    ...spied,
    "tests/one.test.ts": `${head}
test("spies", () => {
  const spy = new Function("holder", "spy", "return spy(holder, 'a' + 'dd')")(lib, spyOn).mockReturnValue(99);
  console.log(byName(), byNamespace(), lib.twice(2), spy.mock.calls.length);
  spy.mockRestore();
  console.log(byName(), byNamespace(), lib.twice(2));
});`,
  });
});

test("a spy that a test hands to the product, which calls it with the namespace object", async () => {
  await expectCompiledToRunAsPlain({
    ...spied,
    "tests/one.test.ts": `${head}
test("spies", () => {
  const spy = apply([spyOn][Number(process.argv.length < 0)], lib, "add").mockReturnValue(7);
  console.log(byName(), byNamespace(), lib.twice(2), spy.mock.calls.length);
  spy.mockRestore();
  console.log(byName(), byNamespace(), lib.twice(2));
});`,
  });
});
