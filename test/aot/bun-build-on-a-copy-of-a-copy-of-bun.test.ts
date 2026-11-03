// `{ ...{ ...Bun } }.build()` is a call of Bun.build, and the report lists it, however far from the copy the call stands.
// The inner copy notes that it was made from the Bun that the program names. The outer copy has to take that note along.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { test } from "./supported";

let program = `const functionNobodyKnows = globalThis[["Str", "ing"].join("")];
const copy = { ...{ ...Bun } };
console.log(functionNobodyKnows(copy).length > 0);
const step0 = { next: () => copy.build({ entrypoints: [] }) };
`;
for (let index = 1; index < 8; index++) program += `const step${index} = { next: () => step${index - 1}.next() };\n`;
program += `try {
  const result = await step7.next();
  console.log("built:", result.success, result.outputs.length);
} catch (error) {
  console.log("threw:", String(error.message).slice(0, 90));
}
`;

test("Bun.build called on a copy of a copy of Bun runs code that the compiler has not seen", async () => {
  using dir = tempDir("aot-copy-of-a-copy-of-bun", { "main.js": program });
  const report = join(String(dir), "report.json");
  await using build = Bun.spawn({
    cmd: [bunExe(), ...compileCommand, ...withReport(report, "summary"), "./main.js", "--outfile", "out"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(readBuildReport(report).unseenCode).toContainEqual(
    expect.objectContaining({ cause: "RunsUnseenCode", builtin: "Bun.build" }),
  );
});
