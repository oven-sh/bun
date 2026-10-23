import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    import { EventEmitter, on } from "node:events";
    const rounds = Number(process.argv[2]);
    const emitter = new EventEmitter();
    const events = on(emitter, "number");
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
      emitter.emit("number", round);
      const { value, done } = await events.next();
      sum += done ? 0 : value[0];
    }
    Bun.gc(true);
    console.log(sum === (rounds * (rounds - 1)) / 2);
  `,
};

const operations = ["operationAOTGetByIdAndCache", "operationAOTGetById"];

test("a built-in module that reads a property under a private name of the engine stops asking the run time for it", async () => {
  using dir = tempDir("aot-private-names-of-the-engine", files);
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
    const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "true\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(operations.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
