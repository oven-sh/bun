// `new.target`: the word `target` may not be written with an escape. `bun <file>` refuses the text, and so does the build.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("the word written with an escape", async () => {
  using sources = tempDir("aot-new-target-with-an-escape", {
    "main.cjs": "function f() {\n  return new.t\\u0061rget;\n}\nconsole.log(typeof f());\n",
  });
  const executable = join(String(sources), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.cjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(1);
  expect(built.stderr).toContain(
    "TS17012: 't\\u0061rget' is not a valid meta-property for keyword 'new'. Did you mean 'target'?",
  );
});

test("the word as it is", async () => {
  using sources = tempDir("aot-new-target", {
    "main.cjs": "function f() {\n  return new.target;\n}\nconsole.log(typeof f(), typeof new f());\n",
  });
  const executable = join(String(sources), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.cjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "undefined function\n", exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(sources), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: "undefined function\n",
    exitCode: 0,
  });
});
