// A program that awaits uses process.nextTick, and so does nearly every program. A row of the table of built-ins that lets native code
// queue a function nobody knows on behalf of something that common opens the world for all of them: the answers stay right, the code
// grows and the build starts over. Nothing else shows it, so the count is held here at none.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

const awaitsAndReadsBytes = `const bytes = Buffer.alloc(8, 1);
function sum(view: Buffer): number {
  let total = 0;
  for (const byte of view) total += byte;
  return total + view.readUInt32BE(0);
}
const jobs: Array<() => number> = [() => sum(bytes), () => bytes.length];
let total = 0;
for (const job of jobs) total += await job();
console.log(total);
`;

test("a program that awaits and reads a Buffer", async () => {
  using folder = tempDir("aot-no-unknown-callee", { "main.ts": awaitsAndReadsBytes, "tsconfig.json": tsconfig });
  const report = join(String(folder), "report.json");
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, "./main.ts", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], String(folder), bunEnv);
  const { FlowCallsOfUnknownCallees, EngineRuns } = JSON.parse(readFileSync(report, "utf8")).statistics;
  expect({ stdout: stdout.trim(), exitCode, FlowCallsOfUnknownCallees, EngineRuns }).toEqual({
    stdout: "16843025",
    exitCode: 0,
    FlowCallsOfUnknownCallees: 0,
    EngineRuns: 1,
  });
});
