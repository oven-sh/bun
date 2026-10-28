import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    class Point {
      constructor(x) { this.x = x; }
    }
    const rounds = Number(process.argv[2]);
    async function awaits(value) {
      let sum = 0;
      for (let round = 0; round < rounds; round++) sum += (await value).x;
      return sum;
    }
    const alone = [await awaits({ x: 1 }), await awaits(new Point(2))];
    const together = await Promise.all([awaits({ x: 3 }), awaits(new Point(4)), awaits({ x: 5 })]);
    console.log([...alone, ...together].map(sum => sum / rounds).join(" "));
  `,
};

const awaits = ["operationAOTAwaitWithSavedFrame", "operationAOTSaveFrameAndAwait"];

test("an await of an object without a then stops asking the run time, alone and beside other awaits", async () => {
  using dir = tempDir("aot-awaits-of-objects", files);
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
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "1 2 3 4 5\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(awaits.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // Each function suspends a first time through an operation. A renamed operation would count none.
  expect(awaits.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    awaits.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(awaits.map(name => [name, "level"])));
}, 240_000);
