import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const count = 300_000;
const files = {
  "main.js": `
    const count = ${count};
    const large = {};
    for (let index = 0; index < count; index++) large["name" + index] = index;
    const names = Object.keys(large);
    const small = { only: 1 };
    let found = 0;
    for (let index = 0; index < count; index++) {
      if (small[names[index]] !== undefined) found++;
      if (index % 50_000 === 49_999) Bun.gc(true);
    }
    console.log(found);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("names that are read once each are still told from names that come back after hundreds of thousands of them", async () => {
  using dir = tempDir("aot-first-misses-forgotten", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const path = join(String(dir), "counts");
  const ran = await run([executable], String(dir), {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    BUN_JSC_aotCountsPath: path,
  });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "0\n", exitCode: 0 });
  let firstMisses = 0;
  let asked = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [value, name] = line.split("\t");
    if (name === "counter:FirstMissesNotFiled") firstMisses = Number(value);
    if (name === "operation:operationAOTGetByValGeneric" || name === "operation:operationAOTGetByValAndCache")
      asked += Number(value);
  }
  // On x86-64 the object itself answers a name that is in no table, and nothing is there to be told apart.
  if (process.arch === "x64") expect(asked).toBeLessThan(count / 8);
  else expect(firstMisses).toBeGreaterThan((count * 2) / 3);
}, 240_000);
