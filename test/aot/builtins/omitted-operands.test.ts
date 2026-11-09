import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

test("a required operand that takes undefined may be left out: native code does the same", async () => {
  using dir = tempDir("aot-omitted-operands", { "table.json": JSON.stringify(aotBuiltinEntries()) });
  const fixture = join(import.meta.dir, "omitted-operands.fixture.js");
  const notChecked = join(import.meta.dir, "differential/not-checked.txt");
  const { stdout, exitCode } = await run([bunExe(), fixture, notChecked, "table.json"], String(dir), bunEnv);
  expect({ lines: stdout.trim().split("\n"), exitCode }).toEqual({ lines: ["ASKED true"], exitCode: 0 });
}, 120_000);

test("native code that counts its operands finds as many as are written", async () => {
  const calls = [
    "fetch()",
    "Bun.fetch()",
    "new Worker()",
    "new WebAssembly.Suspending()",
    "new WebAssembly.Tag()",
    "Buffer()",
    "new Event()",
    "fetch(undefined)",
    "new WebAssembly.Tag(undefined)",
  ];
  const source = `const calls = [${calls.map(call => `async () => ${call}`).join(", ")}];
for (const call of calls) {
  try {
    console.log(Object.prototype.toString.call(await call()));
  } catch (error) {
    console.log(error.name, error.code, error.message.replace(/ \\(evaluating .*/, ""));
  }
}
`;
  using dir = tempDir("aot-omitted-operands", { "main.js": source });
  const plain = await run([bunExe(), "main.js"], String(dir), bunEnv);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([join(String(dir), "main")], String(dir), bunEnv);
  expect(plain.stdout.split("\n")[0]).toBe(`TypeError ERR_MISSING_ARGS The "input" argument must be specified`);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);
