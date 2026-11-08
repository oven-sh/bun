// `--aot-program-file=` is a word for a Bun that holds no program: a test run starts its program with it. To an executable it is an argument of the program like any other.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

test("an executable of bun build --compile is handed --aot-program-file=", async () => {
  using dir = tempDir("plain-executable-arguments", {
    "main.js": "console.log(JSON.stringify(process.argv.slice(2)));\n",
  });
  const app = join(String(dir), isWindows ? "app.exe" : "app");
  const built = await run([bunExe(), "build", "--compile", "./main.js", "--outfile", app], String(dir), bunEnv);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const env = { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" };
  const { stdout, exitCode } = await run([app, "--aot-program-file=./none"], String(dir), env);
  expect({ stdout, exitCode }).toEqual({ stdout: '["--aot-program-file=./none"]\n', exitCode: 0 });
}, 120_000);
