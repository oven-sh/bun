import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// An executable refuses such a store: parallel/modules/bun-main-stored-where-the-build-cannot-see-it-is-refused. In a test run the runner itself stores there, for each test file.
const files = {
  "package.json": `{ "name": "suite" }`,
  "a.test.js": `import { test } from "bun:test";
    test("a store into Bun.main", () => {
      const atFirst = Bun.main;
      for (const store of [path => void (Bun[process.env.KEY] = path), path => void Reflect.set(Bun, process.env.KEY, path), path => void (0, eval)(process.env.TEXT)(path)]) {
        store("/elsewhere/cli.js");
        console.log("stored:", Bun.main);
        store(atFirst);
        console.log("back:", Bun.main === atFirst);
      }
    });`,
};

async function runTests(directory: string, ...flags: string[]) {
  const env = { ...bunEnv, KEY: "main", TEXT: "path => { Bun.main = path; }" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

test("a test stores into Bun.main where the build does not see it", async () => {
  using dir = tempDir("aot-a-test-stores-into-bun-main", files);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({ stdout: Array(3).fill(["stored: /elsewhere/cli.js", "back: true"]).flat(), exitCode: 0 });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
