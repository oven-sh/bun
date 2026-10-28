import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    function makePoint(x) { return { x, y: 2 }; }
    async function returns(value) { return value; }
    const rounds = Number(process.argv[2]);
    const emptied = makePoint(1);
    emptied[process.argv[3]] = 1;
    delete emptied[process.argv[3]];
    const tagged = makePoint(2);
    tagged[process.argv[3]] = 1;
    let sum = 0;
    for (let round = 0; round < rounds; round++) sum += (await returns(emptied)).x + (await returns(tagged)).x;
    console.log(sum === 3 * rounds);
  `,
};

const resolutions = ["operationAOTResolvePromise", "operationAOTResolvePromiseOrReturnResult"];

test("an async function that returns an object with extra properties, or one that had some, stops asking the run time", async () => {
  using dir = tempDir("aot-async-results-with-extra-properties", files);
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
    expect(await run([executable, String(rounds), "tag"], String(dir), env)).toEqual({
      stdout: "true\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(resolutions.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The first result of each kind finds no answer in its Structure. A renamed operation would count none.
  expect(resolutions.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    resolutions.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(resolutions.map(name => [name, "level"])));
}, 240_000);
