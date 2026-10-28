import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The entry point imports two CommonJS files, a module that is not there, and one more file. The first two run, and the job of the second; the third never does.

const files = {
  "main.mjs": `import "./first.cjs";
import "./second.cjs";
import "./absent.mjs";
import "./third.cjs";
console.log("body of the entry point");
`,
  "first.cjs": `console.log("first runs");
process.on("exit", code => console.log("exit code", code));
`,
  "second.cjs": `console.log("second runs");
Promise.resolve().then(() => console.log("job of second"));
`,
  "third.cjs": `console.log("third runs");
`,
};

test("the executable prints what bun run prints", async () => {
  using dir = tempDir("entry-point-imports-files-around-a-module-that-is-not-there", files);
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "--external", "./absent.mjs", "main.mjs", "--outfile", executable],
    String(dir),
  );
  expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });

  // In which step of a load a file runs goes by the thread that transpiles it.
  const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
  const plain = await run([bunExe(), "run", "main.mjs"], String(dir), env);
  const compiled = await run([executable], String(dir), env);
  expect(plain.stdout).toBe("first runs\nsecond runs\njob of second\nexit code 1\n");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    exitCode: plain.exitCode,
  });
  expect(compiled.stderr).toContain("./absent.mjs");
}, 600_000);
