import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// What tests replace is looked for in the texts of a test file too, since a test may hand code over as a text. `import argparse, os` reads as an import with no `from`.
test("a Python script in a template", async () => {
  using dir = tempDir("script-kept-as-a-text", {
    "one.test.ts": `
      import { expect, test } from "bun:test";
      const script = String.raw\`import argparse, os
ap = argparse.ArgumentParser(description=__doc__)
print(ap.parse_args())\`;
      const other = "import sys, json\\nsys.stdout.write(json.dumps(sys.argv))";
      test("the texts are what was written", () => {
        console.log(script.length, other.length);
        expect(script.startsWith("import argparse")).toBe(true);
      });`,
  });
  const results = [];
  for (const flags of [[], ["--aot"]]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    results.push({ stdout, passed: /^\(pass\) the texts are what was written/m.test(stderr), exitCode });
  }
  expect(results[0]).toEqual({ stdout: expect.stringContaining("92 55"), passed: true, exitCode: 0 });
  expect(results[1]).toEqual(results[0]);
});
