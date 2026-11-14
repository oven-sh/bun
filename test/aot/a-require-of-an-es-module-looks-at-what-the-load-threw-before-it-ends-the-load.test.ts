// c.cjs, which an ES module imports, has used process.nextTick and requires e.mjs, which imports a CommonJS file of its own, so the loader takes the load. The require()
// ended the load, which may run files that wait in the loader, before it had looked at what the load threw. Nothing showed in a release build; a Bun with assertions
// that checks how exceptions are looked at (BUN_JSC_validateExceptionChecks=1, as CI's sanitizer lane sets it) stopped. mocha 12.0.3 loads that way.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p" }`,
  "a.test.mjs": `import { test } from "bun:test";\nimport c from "./c.cjs";\nimport t from "./throws.cjs";\ntest("x", () => { console.log("SAID", c, t); });`,
  "main.mjs": `import c from "./c.cjs";\nimport t from "./throws.cjs";\nconsole.log("SAID", c, t);`,
  "c.cjs": `process.nextTick(() => console.log("SAID tick"));\nmodule.exports = require("./e.mjs").v;`,
  "e.mjs": `import d from "./d.cjs";\nexport const v = d;`,
  "d.cjs": `module.exports = 2;`,
  "throws.cjs": `try { require("./bad.mjs"); module.exports = "no error"; } catch (error) { module.exports = error.message; }`,
  "bad.mjs": `import d from "./bad.cjs";\nexport const v = d;`,
  "bad.cjs": `throw new Error("thrown while it loads");`,
};

const env = { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" };
const said = ({ stdout, stderr, exitCode }: { stdout: string; stderr: string; exitCode: number }) => {
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
};

test("in a test run", async () => {
  using dir = tempDir("a-require-of-an-es-module-looks-first", files);
  const plain = said(await run([bunExe(), "test"], String(dir), env));
  expect(plain).toEqual(["SAID tick", "SAID 2 thrown while it loads"]);
  expect(said(await run([bunExe(), "test", "--aot"], String(dir), env))).toEqual(plain);
});

test("in an executable", async () => {
  using dir = tempDir("a-require-of-an-es-module-looks-first", files);
  const plain = said(await run([bunExe(), "main.mjs"], String(dir), env));
  expect(plain).toEqual(["SAID tick", "SAID 2 thrown while it loads"]);
  said(await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "built"], String(dir), env));
  expect(said(await run([join(String(dir), "built")], String(dir), env))).toEqual(plain);
});
