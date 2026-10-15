import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function run(cwd: string, program: string, env: Record<string, string> = {}) {
  await using ran = Bun.spawn({ cmd: [bunExe(), "run", "--aot", program], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("bun run --aot refuses a compiled file that another realm asks for, as the executable does", async () => {
  const folder = join(import.meta.dir, "programs", "untyped-code");
  const expected = readFileSync(join(folder, "the-program-asked-for-by-another-realm.expected.txt"), "utf8");
  expect(await run(folder, "./the-program-asked-for-by-another-realm.ts", { BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
}, 120_000);

test("another realm still loads a file that is not of the program", async () => {
  using dir = tempDir("aot-another-realm", {
    "outside.mjs": `export const value = "not of the program";`,
    "program.mjs": `
      const realm = new ShadowRealm();
      console.log(await realm.importValue(new URL("./out" + ["side"][0] + ".mjs", import.meta.url).href, "value"));
    `,
  });
  expect(await run(String(dir), "./program.mjs")).toEqual({ stdout: "not of the program\n", stderr: "", exitCode: 0 });
}, 120_000);
