import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "own", "private": true }`,
  "throws.cjs": `throw new Error("thrown");
`,
  "catches.cjs": `try { require("./throws.cjs"); } catch {}
exports.a = 1;
`,
  "runs.cjs": `globalThis.ran = true;
exports.a = 5;
`,
  "imports.mjs": `import "./catches.cjs";
import "./throws.cjs";
import "./runs.cjs";
`,
  "a.test.mjs": `import { test } from "bun:test";
test("loads", async () => {
  const all = [];
  all.push(import("./throws.cjs").catch(e => e.message));
  all.push(import("./imports.mjs").catch(e => e.message));
  console.log(await Promise.all(all));
  console.log("ran", globalThis.ran);
});
`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.mjs"], directory, bunEnv);
  return { stdout: stdout.replace(/^bun test .*\n/, ""), passed: /^ *1 pass/m.test(stderr), exitCode };
}

for (const flags of [[], ["--isolate"]]) {
  test(`a file behind one that throws runs before import() settles ${flags.join()}`, async () => {
    using directory = tempDir("file-behind-one-that-throws", files);
    const expected = { stdout: `[ "thrown", "thrown" ]\nran true\n`, passed: true, exitCode: 0 };
    expect(await runTests(String(directory), ...flags)).toEqual(expected);
    expect(await runTests(String(directory), "--aot", ...flags)).toEqual(expected);
  });
}
