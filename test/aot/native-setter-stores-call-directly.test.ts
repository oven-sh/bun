import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    const signal = new AbortController().signal;
    const timer = setTimeout(() => {}, 1_000_000);
    const handlers = [() => 1, () => 2];
    let held = 0;
    for (let round = 0; round < rounds; round++) {
      const handler = handlers[round & 1];
      signal.onabort = handler;
      timer._onTimeout = handler;
      held += (signal.onabort === handler ? 1 : 0) + (timer._onTimeout === handler ? 1 : 0);
    }
    clearTimeout(timer);
    const heir = Object.create(signal);
    let thrown = "nothing";
    try { heir.onabort = handlers[0]; } catch (error) { thrown = error.constructor.name; }
    Object.defineProperty(signal, "onabort", { value: "own", writable: true, configurable: true });
    signal.onabort = "stored";
    console.log(held === 2 * rounds, thrown, signal.onabort, Object.getOwnPropertyNames(signal).join());
    Bun.gc(true);
  `,
  "stores.mjs": `
    const rounds = Number(process.argv[2]);
    const timer = setTimeout(() => {}, 1_000_000);
    const handlers = [() => 1, () => 2];
    for (let round = 0; round < rounds; round++) timer._onTimeout = handlers[round & 1];
    clearTimeout(timer);
    console.log("stored");
    Bun.gc(true);
  `,
};

test.each(["main", "stores"])(
  "a store that reaches a native setter looks nothing up once the setter is known: %s.mjs",
  async name => {
    using dir = tempDir("aot-stores-to-native-setters", files);
    const plain = await run([bunExe(), name + ".mjs", "500"], String(dir), bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const executable = join(String(dir), name + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", name + ".mjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const counted = async (rounds: number) => {
      const path = join(String(dir), "counts" + rounds);
      const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
        stdout: plain.stdout,
        stderr: "",
        exitCode: 0,
      });
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name === "operationAOTPutByIdAndCache") return Number(count);
      }
      return 0;
    };
    const few = await counted(500);
    const many = await counted(2500);
    expect(many - few).toBeLessThanOrEqual(200);
  },
  240_000,
);
