import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "m.ts": `export const standalone = Bun.isStandaloneExecutable;
export const shipped = () => require("made-up-scheme:.");
`,
  "main.ts": `import { standalone } from "./m";
console.log(standalone);
`,
  "a.test.ts": `import { expect, test } from "bun:test";
import { shipped, standalone } from "./m";
test("a guarded helper does not reach what only a shipped build resolves", () => {
  expect(standalone).toBe(false);
  if (standalone) shipped();
});
`,
};

test("Bun.isStandaloneExecutable is true in an executable alone", async () => {
  using dir = tempDir("aot-standalone-flag", files);
  const directory = String(dir);
  const ran = await run([bunExe(), "run", "--aot", "main.ts"], directory, bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "false\n", exitCode: 0 });

  const tested = await run([bunExe(), "test", "--aot", "./a.test.ts"], directory, bunEnv);
  expect(tested.stderr).toContain("1 pass");
  expect(tested.exitCode).toBe(0);

  const outfile = join(directory, process.platform === "win32" ? "out.exe" : "out");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    directory,
    bunEnv,
  );
  expect(build.exitCode).toBe(0);
  const shipped = await run([outfile], directory, bunEnv);
  expect({ stdout: shipped.stdout, exitCode: shipped.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
}, 60_000);
