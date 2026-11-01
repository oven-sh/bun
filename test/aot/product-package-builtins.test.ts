// "A dependency changes built-in objects" is how an executable typically fails: iconv-lite under koa assigns to Buffer.isEncoding. A test run let every package write, because
// packages that help tests have to: nock and msw patch `fetch`, sinon whatever a test names. So the suite was green and the executable threw.
// A package is the product's if a file of the product loads it, directly or through other packages: that is what the executable holds. It meets in a test run what it meets there,
// also where a test file imports it too. A package that the files of the tests alone load replaces what it likes.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(240_000);

const test = oneAtATime.concurrent;

const writes = {
  "node_modules/writes/package.json": `{ "name": "writes", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/writes/index.js": `
exports.write = function write() {
  const original = Buffer.isEncoding;
  Buffer.isEncoding = function isEncoding(name) { return name === "made-up" || original(name); };
  Object.prototype.planted = 1;
  return () => { Buffer.isEncoding = original; delete Object.prototype.planted; };
};`,
  "node_modules/through/package.json": `{ "name": "through", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/through/index.js": `exports.write = require("writes").write;`,
};

const answers = (from: string) => `
import { write } from "${from}";
let said: unknown = "stored";
try { write(); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; }
process.stdout.write("ANSWER " + String(said) + " " + Buffer.isEncoding("made-up") + " " + ("planted" in {}) + "\\n");
`;

const onlyImports = `import { test } from "bun:test";\nimport "../product/main.ts";\ntest("runs", () => {});\n`;

const products = {
  "that a file of the product imports": { "product/main.ts": answers("writes"), "tests/entry.test.ts": onlyImports },
  "that a file of the product reaches through another package": {
    "product/main.ts": answers("through"),
    "tests/entry.test.ts": onlyImports,
  },
  "that a test file imports too": {
    "product/main.ts": answers("writes"),
    "tests/entry.test.ts": `import { test } from "bun:test";\nimport { write } from "writes";\nimport "../product/main.ts";\ntest("runs", () => void typeof write);\n`,
  },
};

const forms = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
];

describe.skipIf(isWindows)("a package meets in a test run what it meets in the executable", () => {
  for (const [title, files] of Object.entries(products)) {
    test(title, async () => {
      const folder = String(
        tempDir("aot-package-writes", { ...writes, ...files, "entry.ts": `import "./product/main.ts";\n` }),
      );
      const answerOf = async (words: string, ...cmd: string[]) => {
        const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
        await using child = Bun.spawn({ cmd, cwd: folder, env, stdout: "pipe", stderr: "pipe" });
        const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        expect({ err: exitCode ? err : "", exitCode }).toEqual({ err: "", exitCode: 0 });
        // Who loads a package shows behind the load. Nothing is loaded a second time for what it writes.
        expect(err).not.toContain("AOT build starts over | replaced built-ins added");
        return out.split("\n").filter(line => line.startsWith("ANSWER"));
      };
      await answerOf("", bunExe(), "build", "--compile", "--aot", "./entry.ts", "--outfile", "program");
      const executable = await answerOf("", join(folder, "program"));
      expect(executable).toEqual([expect.stringContaining("TypeError: Cannot assign to Buffer.isEncoding")]);
      for (const [form, words] of forms) {
        expect({ form, answers: await answerOf(words, bunExe(), "test", "--aot") }).toEqual({
          form,
          answers: executable,
        });
      }
    });
  }
});

const reads = {
  "product/reads.ts": `export const answers = () => [Buffer.isEncoding("made-up"), "planted" in {}].join();`,
};

test("a package that a test file alone imports replaces what it likes", async () => {
  await expectCompiledToRunAsPlain({
    ...writes,
    ...reads,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { write } from "through";
import { answers } from "../product/reads";
test("replaces", () => {
  const undo = write();
  console.log(answers());
  undo();
  console.log(answers());
});`,
  });
});

test("so does one that a helper among the sources imports which takes something from the test runner", async () => {
  await expectCompiledToRunAsPlain({
    ...writes,
    ...reads,
    "product/testing/stubs.ts": `import { mock } from "bun:test";\nimport { write } from "writes";\nexport const stub = mock(write);`,
    "tests/one.test.ts": `
import { test } from "bun:test";
import { answers } from "../product/reads";
import { stub } from "../product/testing/stubs";
test("replaces", () => {
  const undo = stub();
  console.log(answers());
  undo();
  console.log(answers());
});`,
  });
});
