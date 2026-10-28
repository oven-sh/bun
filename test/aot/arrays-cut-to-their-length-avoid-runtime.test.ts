import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const turns = 2000;
const files = {
  "main.mjs": `
    const whole = [1, 2, 3, 4, 5, 6, 7, 8];
    const fractions = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
    const texts = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"];
    function turn(i) {
      const a = whole.filter(x => x > 2).map(x => x + i);
      const b = fractions.map(x => x * 2).filter(x => x > 6);
      const c = texts.filter(x => x.length > 1).map(x => x.length);
      return a.length + a[1] + b.length + b[2] + c.length + c[3];
    }
    let sum = 0;
    for (let i = 0; i < ${turns}; i++) sum += turn(i);
    console.log(sum);
  `,
};

test("an array that a chain of array methods has filled is cut to its length without leaving compiled code", async () => {
  using dir = tempDir("aot-arrays-cut-to-their-length", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const plain = await run([bunExe(), "main.mjs"], String(dir), bunEnv);
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name === "operationAOTTruncateNewArray") calls += Number(count);
  }
  // Three arrays a turn are cut by two or three elements.
  expect(calls).toBeLessThan(turns / 100);
});
