import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const rounds = 600;

const files = {
  "main.mjs": `
    class Holder {
      #raw;
      #request;
      env = {};
      #variables;
      finalized = false;
      error;
      #status;
      #path;
      constructor(raw, path) {
        this.#raw = raw;
        this.#path = path;
      }
      get path() {
        return this.#path;
      }
    }
    const objectsPerRound = Number(process.argv[2]);
    const survivors = [];
    function createHolders(count) {
      let length = 0;
      for (let n = 0; n < count; n++) {
        const holder = new Holder(n, "/json");
        if (n % 1000 === 0) survivors.push(holder);
        length += holder.path.length;
      }
      survivors.length = 0;
      return length;
    }
    let total = 0;
    for (let round = 0; round < ${rounds}; round++) {
      Bun.gc(true);
      total += createHolders(objectsPerRound);
    }
    Bun.gc(true);
    console.log(total);
  `,
};

const storeOperations = [
  "operationAOTTryPutProperties",
  "operationAOTPrivateDefine",
  "operationAOTPrivateSet",
  "operationAOTPutByIdAndCache",
  "operationAOTDefineById",
  "operationAOTDefineField",
];

test("field stores of a class with private fields stay off the slow path after any number of full collections", async () => {
  using dir = tempDir("aot-private-fields-across-full-collections", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counted = async (objectsPerRound: number) => {
    const path = join(String(dir), "counts" + objectsPerRound);
    const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_aotCountsPath: path };
    const total = rounds * objectsPerRound * "/json".length;
    expect(await run([executable, String(objectsPerRound)], String(dir), env)).toEqual({
      stdout: total + "\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(
      ["operationAOTNewClassToken", ...storeOperations].map(name => [name, 0]),
    );
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(200);
  const many = await counted(1000);
  expect(few.operationAOTNewClassToken).toBeGreaterThan(0);
  expect(few.operationAOTTryPutProperties).toBeLessThan(1300);
  expect(few.operationAOTPrivateDefine).toBeLessThan(100);
  const growth = Object.fromEntries(
    storeOperations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(growth).toEqual(Object.fromEntries(storeOperations.map(name => [name, "level"])));
}, 240_000);
