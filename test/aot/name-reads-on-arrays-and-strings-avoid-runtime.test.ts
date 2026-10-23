import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    function describe(value) {
      return (value.name ?? "none") + " " + (value.prototype ?? "none") + " " + value.length;
    }
    const values = [[1, 2], "text", [0.5]];
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(describe(values[round % 3]));
    console.log([...seen].join(" | "));
    values[0].name = "own";
    values[2].prototype = "own too";
    console.log(values.map(describe).join(" | "), "|", describe([]));
  `,
};

const reads = ["operationAOTGetById", "operationAOTGetByIdAndCache", "operationAOTGetGeneric"];

test("a read of `name` or `prototype` that an array or a string does not have stops asking the run time", async () => {
  using dir = tempDir("aot-name-reads-on-arrays-and-strings", files);
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
      stdout: "none none 2 | none none 4 | none none 1\nown none 2 | none none 4 | none own too 1 | none none 0\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(reads.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The first read of each kind of receiver misses its cache. A renamed operation would count none.
  expect(reads.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    reads.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(reads.map(name => [name, "level"])));
}, 240_000);
