// A program stores `Function` under a computed key into a value that the flow analysis cannot follow. From then on each call
// of a value read off such a value may be a call of `Function`, which evaluates text that the compiler has not seen.
// The build's report says so with the first few places, not with one record for each such call: a large program has a
// quarter of a million of them, and they all say the same.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const calls = 40;

function source() {
  let text = `const given = globalThis[process.argv[2] ?? "nothing"] ?? { f() { return 1; } };\nlet sum = 0;\n`;
  text += `given[process.argv[3] ?? "keep"] = Function;\n`;
  for (let index = 0; index < calls; index++) text += `sum += given.f(${index});\n`;
  return text + `console.log(sum);\n`;
}

test("forty calls that may be calls of Function have a few records", async () => {
  using dir = tempDir("aot-calls-of-values-nobody-follows", { "main.js": source() });
  const directory = String(dir);
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const reportPath = join(directory, "report.json");
  const built = await run(
    [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.js", "--outfile", executable],
    directory,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  expect((await run([executable], directory, bunEnv)).stdout).toBe(`${calls}\n`);
  const records = readBuildReport(reportPath).unseenCode.filter(record => record.builtin === "Function");
  expect(records.length).toBeGreaterThan(0);
  expect(records.length).toBeLessThanOrEqual(8);
}, 120_000);
