import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "a.txt": "hello",
  "main.cjs": `console.log(JSON.stringify(require("./a.txt")));`,
  "self.test.ts": `import { expect, test } from "bun:test";
import * as self from "./self.test.ts";
test("the namespace object takes the mark, and require of text answers its namespace", () => {
  (self as any).__esModule = true;
  expect((self as any).__esModule).toBe(true);
  expect(require("./a.txt")).toEqual({ default: "hello" });
});
`,
};

test("a compiled run answers as bun run, and an executable as bun build --compile", async () => {
  using dir = tempDir("aot-as-bun-test", files);
  const directory = String(dir);
  const ran = await run([bunExe(), "run", "--aot", "main.cjs"], directory, bunEnv);
  expect(ran.stdout).toBe(`{"default":"hello"}\n`);
  const tested = await run([bunExe(), "test", "--aot", "./self.test.ts"], directory, bunEnv);
  expect(tested.stderr).toContain("1 pass");
  expect(tested.exitCode).toBe(0);
  const outfile = join(directory, process.platform === "win32" ? "out.exe" : "out");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", outfile],
    directory,
    bunEnv,
  );
  expect(build.exitCode).toBe(0);
  expect((await run([outfile], directory, bunEnv)).stdout).toBe(`"hello"\n`);
}, 60_000);
