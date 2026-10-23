import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.mjs": `
    const [shapes, namesPerShape, rounds] = process.argv.slice(2).map(Number);
    const objects = [];
    const names = [];
    for (let n = 0; n < namesPerShape; n++) names.push("made" + n + String.fromCharCode(97 + (n % 26)));
    for (let s = 0; s < shapes; s++) {
      const object = {};
      object["shape" + s] = s;
      for (const name of names) object[name] = 1;
      objects.push(object);
    }
    let sum = 0;
    for (let round = 0; round < rounds; round++) for (const object of objects) for (const name of names) sum += object[name];
    console.log(sum);
  `,
};

const initialNumberOfEntries = 1024;

test("reads under names made at run time evict each other until the table has grown, and no longer", async () => {
  using dir = tempDir("aot-hot-names-made-at-run-time", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode, built.stderr).toBe(0);
  const counted = async (shapes: number, namesPerShape: number, rounds: number) => {
    const path = join(String(dir), `counts-${shapes}-${namesPerShape}-${rounds}`);
    const ran = await run([executable, String(shapes), String(namesPerShape), String(rounds)], String(dir), {
      ...bunEnv,
      BUN_JSC_aotCountsPath: path,
    });
    expect(ran).toEqual({ stdout: shapes * namesPerShape * rounds + "\n", stderr: "", exitCode: 0 });
    const counts = { evictions: 0, growths: 0 };
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name === "counter:HashedTableEvictions") counts.evictions = Number(count);
      if (name === "counter:HashedTableGrowths") counts.growths = Number(count);
    }
    return counts;
  };

  // More keys than entries: some set of four holds too many, whatever the addresses are. While a set holds too many, each round evicts several times.
  const rounds = 6000;
  expect(80 * 15).toBeGreaterThan(initialNumberOfEntries);
  const { evictions, growths } = await counted(80, 15, rounds);
  expect(growths).toBeGreaterThan(0);
  expect(evictions).toBeLessThan(rounds);

  // A table that holds its keys stays as small as it was.
  expect(await counted(6, 6, rounds)).toEqual({ evictions: 0, growths: 0 });
}, 240_000);
