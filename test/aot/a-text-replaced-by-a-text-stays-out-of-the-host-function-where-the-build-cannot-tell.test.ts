import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const turns = 3000;
const files = {
  "main.mjs": String.raw`
    const steps = [["\\(", "("], ["\\)", ")"], [/\s+/g, found => found[0]]];
    const rules = JSON.parse('["npm run  test:*","python -c \\"print\\\\(1\\\\)\\"","//home/**"]');
    function unescape(text) {
      for (const [from, to] of steps) text = text.replaceAll(from, to);
      return text;
    }
    let sum = 0;
    for (let i = 0; i < ${turns}; i++) sum += unescape(rules[i % rules.length]).length;
    console.log(sum, rules.map(unescape).join(" | "));
  `,
};

// The same holds for a receiver that the build cannot tell, which is most receivers in the cold code of a very large program.
test("replaceAll with a text for a text, at a call that also gets a pattern and a function, does not go through the engine's host function", async () => {
  using dir = tempDir("aot-a-text-for-a-text", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const plain = await run([bunExe(), "main.mjs"], String(dir), bunEnv);
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  let replacements = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name === "operationAOTStringReplaceAllString") replacements += Number(count);
  }
  // Two of the three steps of a turn. A call of the host function counts as none.
  expect(replacements).toBeGreaterThanOrEqual(2 * turns);
});
