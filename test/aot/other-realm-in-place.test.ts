import { expect } from "bun:test";
import { test } from "./supported";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function run(cwd: string, program: string, env: Record<string, string> = {}) {
  await using ran = Bun.spawn({ cmd: [bunExe(), "run", "--debug-aot", program], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("bun run --aot refuses a compiled file that another realm asks for, as the executable does", async () => {
  const folder = join(import.meta.dir, "programs", "untyped-code");
  const expected = readFileSync(join(folder, "program-required-by-other-realm.expected.txt"), "utf8");
  expect(await run(folder, "./program-required-by-other-realm.ts", { BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
}, 120_000);

test("another realm is refused a file that is not of the program, as the program is", async () => {
  using dir = tempDir("aot-another-realm", {
    "outside.mjs": `export const value = "not of the program";`,
    "program.mjs": `
      const realm = new ShadowRealm();
      console.log(await realm.importValue(new URL("./out" + ["side"][0] + ".mjs", import.meta.url).href, "value"));
    `,
  });
  expect(await run(String(dir), "./program.mjs")).toEqual({ stdout: "", stderr: expect.stringContaining("outside.mjs': it isn't in this executable"), exitCode: 1 });
}, 120_000);
