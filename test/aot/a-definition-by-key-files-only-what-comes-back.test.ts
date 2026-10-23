import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.js": `
    function withKey(key, value) {
      return { first: 1, [key]: value };
    }
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
      sum += withKey(String(6), round)[6];
      sum += Object.keys(withKey("name" + round, round)).length;
    }
    console.log(sum);
  `,
};

function countersIn(path: string) {
  const counters: Record<string, number> = { PairsFiledAgain: 0, HashedTableEvictions: 0 };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [value, name] = line.split("\tcounter:");
    if (name !== undefined && name in counters) counters[name] = Number(value);
  }
  return counters;
}

test("a definition by key files nothing for an index written as a string, nor for a name that comes once", async () => {
  using dir = tempDir("aot-definition-by-key", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const counted: Record<string, number>[] = [];
  for (const rounds of [100, 4100]) {
    const path = join(String(dir), "counts-" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    const ran = await run([executable, String(rounds)], String(dir), env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      stdout: `${(rounds * (rounds - 1)) / 2 + 2 * rounds}\n`,
      exitCode: 0,
    });
    counted.push(countersIn(path));
  }
  expect(counted[1]).toEqual(counted[0]);
}, 240_000);
