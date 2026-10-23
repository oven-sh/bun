import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.js": `
    var unseen = new Function("x", "return x");
    function First(x) { this.a = x; }
    First.prototype = { tag: "first" };
    function Second(x) { this.b = x; }
    Second.prototype = { tag: "second" };
    Second.extra = 1;
    unseen(First);
    unseen(Second);
    function isFirst(value) { return value instanceof First; }
    function make(x) { return new First(x); }
    function work(rounds, other) {
      var total = 0;
      for (var round = 0; round < rounds; round++) {
        var made = make(round);
        if (isFirst(made) && !isFirst(other) && made.tag === "first")
          total++;
      }
      return total;
    }
    var rounds = Number(process.argv[2]);
    var other = new Second(1);
    // The first construction defines the class. What a loop has read before that it may go on using.
    var first = work(1, other);
    console.log(first + work(rounds - 1, other) === rounds);
  `,
};

const operations = [
  "operationAOTGetClassPrototype",
  "operationAOTGetConstructPrototype",
  "operationAOTInstanceOfAndCache",
  "operationAOTDefaultHasInstance",
  "operationAOTCreateThis",
];

test("instanceof and new on a constructor function that unseen code has stop asking the run time once its class is defined", async () => {
  using dir = tempDir("aot-instanceof-on-a-constructor-function", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
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
