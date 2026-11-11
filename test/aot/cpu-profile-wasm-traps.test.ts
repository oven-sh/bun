// A trap of compiled WebAssembly is a signal, and on Linux the CPU profiler stops a thread by a signal too.
import { expect } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

// (module (memory 1) (func (export "load") (param i32) (result i32) (i32.load (local.get 0))))
const module = Buffer.from(
  "0061736d0100000001060160017f017f030201000503010001070801046c6f616400000a0901070020002802000b",
  "hex",
);

const source = `import path from "./module.wasm" with { type: "file" };
const { exports } = new WebAssembly.Instance(new WebAssembly.Module(await Bun.file(path).bytes()));
const load = exports.load as (address: number) => number;
const deadline = Date.now() + 300;
let traps = 0;
do {
  for (let i = 0; i < 100; i++) {
    try {
      load(70_000);
    } catch {
      traps++;
    }
  }
} while (Date.now() < deadline);
console.log(load(8), traps > 0);
`;

test("a program whose WebAssembly traps often ends under --cpu-prof", async () => {
  using dir = tempDir("aot-cpu-profile-wasm-traps", { "main.ts": source, "module.wasm": module });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "program.exe" : "program");
  const profilerFlags = "--compile-exec-argv=--cpu-prof --cpu-prof-name=own.cpuprofile";
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", profilerFlags, "main.ts", "--outfile", executable],
      cwd,
      bunEnv,
    ),
  );
  const run = await spawned([executable], cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }, 60_000);
  expect(run).toEqual({ stdout: "0 true\n", stderr: expect.any(String), exitCode: 0, signal: null });
  expect(existsSync(join(cwd, "own.cpuprofile"))).toBe(true);
}, 120_000);
