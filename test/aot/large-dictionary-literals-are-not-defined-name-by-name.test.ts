import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const count = 400;
const files = {
  "main.ts": `
    declare const console: { log(...values: any[]): void };
    const table: Record<string, string> = {
      ${Array.from({ length: count }, (_, index) => `name${index}: "value ${index}",`).join("\n      ")}
    };
    console.log(Object.keys(table).length, table.name0, table["name${count - 1}"]);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

// A literal of constants is read out of the executable. Where it is not, its properties are defined sixteen at a time. Either way no call is made for each name.
test("the properties of a large literal of constants that is a dictionary are not defined one by one", async () => {
  using dir = tempDir("aot-large-dictionary-literals", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], String(dir), bunEnv);
  expect(built.exitCode).toBe(0);
  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  expect(await run([executable], String(dir), env)).toEqual({ stdout: `${count} value 0 value ${count - 1}\n`, stderr: "", exitCode: 0 });
  const counts: Record<string, number> = { operationAOTDefineById: 0, operationAOTTryPutProperties: 0 };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && name in counts) counts[name] = Number(calls);
  }
  expect({ single: counts.operationAOTDefineById! < 16, runs: counts.operationAOTTryPutProperties! <= count / 16 }).toEqual({ single: true, runs: true });
}, 240_000);
