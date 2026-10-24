// A build that does not reach its end says on stderr what it was compiling: the function, the file and line where that function starts, and the step of the compiler.
// That holds however it stops: an assertion of the compiler fails, the compiler reads a bad address, or somebody ends a build that takes too long.
//
// `--aot-sabotage=<name>` (hidden) makes a build stop at a known place: in a function named stopsTheCompiler, or at a step that every build has.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned, withoutCoreDump, withoutCrashReport, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const program = `
const seen: number[] = [];
function stopsTheCompiler(count: number): number {
  let sum = 0;
  for (let index = 0; index < count; index++) sum += index * seen.length;
  seen.push(sum);
  return count > 3 ? stopsTheCompiler(count - 1) + sum : sum;
}
function isCompiledToo(count: number): number {
  return count * 2;
}
console.log(stopsTheCompiler(process.argv.length), isCompiledToo(seen.length), [1, 2, 3].map(stopsTheCompiler).length);
`;
// Methods of one name, each compiled on whichever thread is free.
const manyAtOnce = Array.from(
  { length: 32 },
  (_, index) => `
export const holder${index} = {
  stopsTheCompiler(count: number): number {
    let sum = ${index};
    for (let index = 0; index < count; index++) sum += index % ${index + 2};
    return sum;
  },
};
console.log(holder${index}.stopsTheCompiler(process.argv.length));`,
).join("\n");
const inTheFunction = String.raw`Stopped while compiling stopsTheCompiler \(.*program\.ts:3\)`;

describe("compile/aot/a build that stops says where", () => {
  const folder = String(tempDir("aot-a-build-that-stops", { "program.ts": program, "many-at-once.ts": manyAtOnce }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const carrier = withoutDebugInformation();
  const command = (...flags: string[]) => commandFor("program.ts", ...flags);
  const commandFor = (file: string, ...flags: string[]) =>
    withoutCoreDump([
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...carrier,
      ...flags,
      join(folder, file),
      "--outfile",
      join(folder, `${file}-${flags.join("").replace(/[^A-Za-z0-9]/g, "")}${isWindows ? ".exe" : ""}`),
    ]);
  const environment = { ...bunEnv, ...withoutCrashReport };

  test.concurrent.each([
    [
      "FunctionPassFailsAssertion",
      `${inTheFunction} in EliminateDeadCode\\.\nTo build without that step, add --aot-disable=pass:EliminateDeadCode\\.\n`,
    ],
    [
      "FunctionPassReadsBadAddress",
      `${inTheFunction} in EliminateDeadCode\\.\nTo build without that step, add --aot-disable=pass:EliminateDeadCode\\.\n`,
    ],
    ["CodeGenerationFailsAssertion", `${inTheFunction} in GenerateCode\\.\n`],
    ["ProgramPassFailsAssertion", "Stopped while compiling in BuildCallGraph\\.\n"],
    ["FlowAnalysisFailsAssertion", "Stopped while compiling in AnalyzeFlow[ .]"],
    ["ImageBuildingFailsAssertion", "Stopped while compiling in BuildImage[ .]"],
    ["LoweringPanics", "Stopped while compiling .*program\\.ts in Lower\\.\n"],
  ])(
    "%s",
    async (sabotage, said) => {
      const build = await spawned(command(`--aot-sabotage=${sabotage}`), folder, environment);
      expect({ stderr: build.stderr, hasEndedWell: build.exitCode === 0 }).toEqual({
        stderr: expect.stringMatching(new RegExp(said)),
        hasEndedWell: false,
      });
      // Only threads that stopped are named. Versions of one function are compiled on several threads, which may stop together.
      expect(build.stderr).not.toContain("isCompiledToo");
    },
    300_000,
  );

  // On Windows whoever reports it has only what is left of the same stack.
  test.skipIf(isWindows)(
    "FunctionPassRunsOutOfStack",
    async () => {
      const build = await spawned(command("--aot-sabotage=FunctionPassRunsOutOfStack"), folder, environment);
      expect({ stderr: build.stderr, hasEndedWell: build.exitCode === 0 }).toEqual({
        stderr: expect.stringMatching(new RegExp(`${inTheFunction} in EliminateDeadCode\\.\n`)),
        hasEndedWell: false,
      });
    },
    300_000,
  );

  // The second thread to stop must not end the process in the middle of what the first one says.
  test.concurrent.each([1, 2, 3, 4])(
    "threads that stop at the same moment, %d",
    async round => {
      const build = await spawned(
        commandFor("many-at-once.ts", "--aot-sabotage=FunctionPassFailsAssertion", `--aot-layout-seed=${round}`),
        folder,
        environment,
      );
      expect({ stderr: build.stderr, hasEndedWell: build.exitCode === 0 }).toEqual({
        stderr: expect.stringMatching(
          /Stopped while compiling stopsTheCompiler \(.*many-at-once\.ts:\d+\) in EliminateDeadCode\.\n/,
        ),
        hasEndedWell: false,
      });
    },
    300_000,
  );

  test("the option that the message names gets the build around the step", async () => {
    const build = await spawned(
      command("--aot-sabotage=FunctionPassFailsAssertion", "--aot-disable=pass:EliminateDeadCode"),
      folder,
      environment,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringContaining("Stopped while"),
      exitCode: 0,
    });
  }, 300_000);

  test("a build without a sabotage says nothing of the kind", async () => {
    const build = await spawned(command(), folder, environment);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/Stopped while|Still compiling/),
      exitCode: 0,
    });
  }, 300_000);

  // On Windows a process that another one ends runs nothing more. Ctrl+C in a console does reach it, and no test has a console.
  test.skipIf(isWindows).each(["SIGINT", "SIGTERM", "SIGQUIT"] as const)(
    "a build that never ends, ended by %s, says what it is still compiling",
    async signal => {
      await using build = Bun.spawn({
        cmd: command("--aot-sabotage=FunctionPassNeverEnds"),
        cwd: folder,
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        timeout: 240_000,
        killSignal: "SIGKILL",
      });
      let stderr = "";
      const decoder = new TextDecoder();
      for await (const chunk of build.stderr) {
        const hadArrived = stderr.includes("never ends");
        stderr += decoder.decode(chunk, { stream: true });
        if (!hadArrived && stderr.includes("never ends")) build.kill(signal);
      }
      await build.exited;
      expect({ stderr, signal: build.signalCode }).toEqual({
        stderr: expect.stringMatching(
          /Still compiling stopsTheCompiler \(.*program\.ts:3\) in EliminateDeadCode for \d+ s\.\n/,
        ),
        signal,
      });
    },
    300_000,
  );
});
