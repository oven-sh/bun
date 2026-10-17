import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

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
    const kept = [];
    function made(count) {
      let length = 0;
      for (let n = 0; n < count; n++) {
        const holder = new Holder(n, "/json");
        if (n % 1000 === 0) kept.push(holder);
        length += holder.path.length;
      }
      kept.length = 0;
      return length;
    }
    let total = 0;
    for (let round = 0; round < 600; round++) {
      Bun.gc(true);
      total += made(200);
    }
    Bun.gc(true);
    console.log(total);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("what is learnt about a class with private fields may be learnt again after any number of full collections", async () => {
  using dir = tempDir("aot-private-fields-across-full-collections", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const path = join(String(dir), "counts");
  const env = {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
    BUN_JSC_useAOTOperationCounters: "1",
    BUN_JSC_aotTypeCoverageCountsPath: path,
  };
  expect(await run([executable], String(dir), env)).toEqual({ stdout: "600000\n", stderr: "", exitCode: 0 });
  const counts: Record<string, number> = { operationAOTTypedTryPutProperties: 0, operationAOTTypedPrivateFieldAdd: 0 };
  for (const line of readFileSync(path + ".operations", "utf8").split("\n")) {
    const [count, name] = line.split("\t");
    if (name !== undefined && name in counts) counts[name] = Number(count);
  }
  expect(counts.operationAOTTypedTryPutProperties).toBeGreaterThan(0);
  expect(counts.operationAOTTypedTryPutProperties).toBeLessThan(1300);
  expect(counts.operationAOTTypedPrivateFieldAdd).toBeLessThan(100);
}, 240_000);
