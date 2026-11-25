// A test run reads the code that its test files hold in texts, to find what they replace. `import a, from;` has lost
// the name of its module, and the look for mocks to hoist asked for the text of that name: the run ended in a
// segmentation fault before any test file had started. The second line of the text is what makes the run read it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "h.test.js": `import { test } from "bun:test";
const text = "import a, from;\\ndelete x.prototype.map;\\nfunction f(x) { return x }";
test("one", () => { console.log(text.length); });
`,
};

async function runTests(directory: string, ...flags: string[]) {
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "."],
    env: bunEnv,
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(it => `${it[1]} ${it[2]}`);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed, results, exitCode };
}

test("the run goes on as without --aot", async () => {
  using dir = tempDir("a-text-with-a-broken-import", files);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({ printed: ["66"], results: ["pass one"], exitCode: 0 });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});
