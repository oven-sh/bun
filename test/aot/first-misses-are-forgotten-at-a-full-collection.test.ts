import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

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
  let asked = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [value, name] = line.split("\t");
    if (name === "operation:operationAOTGetByValGeneric" || name === "operation:operationAOTGetByValAndCache")
      asked += Number(value);
  }
  // The object itself answers a name that is in no table, and nothing is there to be told apart.
  expect(asked).toBeLessThan(count / 8);
}, 240_000);
