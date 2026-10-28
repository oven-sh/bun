import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    class Options {
      constructor() { this.host = "localhost"; this.port = 80; }
    }
    const rounds = Number(process.argv[2]);
    const extra = "ex" + process.argv[3];
    const port = "po" + process.argv[4];
    const change = (object, f) => { f(object); return object; };
    const objects = [
      change(new Options(), o => { o[extra] = 1; }),
      change(new Options(), o => { o[extra] = 1; delete o[extra]; }),
      change(new Options(), o => { o[port] = "eighty"; o[port] = 80; }),
      change({ first: 1, second: 2 }, o => { o[extra] = 3; }),
    ];
    function walk(object) {
      let keys = "";
      for (const key in object) keys += key + " ";
      return keys.trim();
    }
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(walk(objects[round & 3]));
    console.log([...seen].join(" | "));
    console.log(objects.map(walk).join(" | "));
    objects[0][extra + "2"] = 2;
    objects[1][extra] = 4;
    delete objects[2][port];
    delete objects[3][extra];
    Object.defineProperty(objects[3], "hidden", { value: 1, enumerable: false });
    console.log(objects.map(walk).join(" | "));
    console.log(objects.map(walk).join(" | "));
    Options.prototype[extra + "3"] = 5;
    console.log(objects.map(walk).join(" | "));
  `,
};

const operations = ["operationAOTGetPropertyEnumerator"];

test("a for-in over one object that has, or once had, a property its class or literal does not declare stops asking the run time", async () => {
  using dir = tempDir("aot-for-in-over-objects-with-extra-properties", files);
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
  const later = "host port extra extra2 | host port extra | host | first second\n";
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds), "tra", "rt"], String(dir), env)).toEqual({
      stdout:
        "host port extra | host port | first second extra\n" +
        "host port extra | host port | host port | first second extra\n" +
        later +
        later +
        "host port extra extra2 extra3 | host port extra extra3 | host extra3 | first second\n",
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
  // The first walks of each object ask. A renamed operation would count none.
  expect(operations.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
