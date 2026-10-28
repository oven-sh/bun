import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const rounds = 5;
const length = 2000;
const files = {
  "main.ts": `
    const later: (() => number)[] = [];
    function fill(n: number): void {
      let count = n;
      later.push(() => ++count);
      if (n > 1) return fill(n - 1);
    }
    let sum = 0;
    for (let round = 0; round < ${rounds}; round++) {
      fill(${length});
      const all = later.map(each => each());
      later.length = 0;
      sum += all.length + all[round];
    }
    console.log(sum);
  `,
};

test("a loop that only reads a list tests what the list holds once a turn", async () => {
  using dir = tempDir("aot-validating-build-tests-a-list-once", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-validate", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const plain = await run([bunExe(), "main.ts"], String(dir), bunEnv);
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name === "operationAOTContentsHaveType") calls += Number(count);
  }
  // Each turn of map() uses the list in several operations that write nothing.
  expect(calls).toBeGreaterThan((rounds * length) / 2);
  expect(calls).toBeLessThan(rounds * length * 2.5);
});
