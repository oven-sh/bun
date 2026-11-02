import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";

const padding = `/* ${"x".repeat(1 << 20)} */`;

test("the program leaves the text of JavaScript out, and toString() still answers it", async () => {
  using dir = tempDir("function-text-out-of-the-program", {
    "main.js": `
      import { typed, Typed } from "./typed.ts";
      ${padding}
      function plain(first, second) {
        // a comment
        return first + second;
      }
      const arrow = value => value * 2;
      class Plain { method() { return "é"; } }
      for (const shown of [plain, arrow, Plain, Plain.prototype.method, typed, Typed]) console.log(String(shown));
    `,
    "typed.ts": `
      export function typed(first: number, second: string): string { return second + first; }
      export class Typed<T> { held: T; constructor(held: T) { this.held = held; } }
    `,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const flags = ["--aot-report=report.json", "--aot-report-detail=summary"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "./main.js", "--outfile", executable],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")).statistics.ProgramBytes).toBeLessThan(1 << 20);
  const { stdout, exitCode } = await run([executable], cwd, bunEnv);
  expect({ stdout, exitCode }).toEqual({
    stdout: [
      `function plain(first, second) {
        // a comment
        return first + second;
      }`,
      `value => value * 2`,
      `class Plain { method() { return "é"; } }`,
      `method() { return "é"; }`,
      `function typed(first, second) { return second + first; }`,
      `class Typed { held; constructor(held) { this.held = held; } }`,
      "",
    ].join("\n"),
    exitCode: 0,
  });
});
