// A build that does not reach its end says on stderr what it was compiling: the function, the file and line where that function starts, and the step of the compiler.
// A compiler that crashes says it in the crash report, behind the reason. No flag makes it crash at a known place, so here somebody ends a build that takes long.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned, withoutCoreDump, withoutCrashReport, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const program = `console.log(process.argv.length);\n`;
// One thread compiles a function from start to finish, so the build is at this one for a good part of its time however many threads it has.
const takesLong = `
function mixes(sum: number, next: number): number {
  return ((sum * 31 + next) % 1000003) ^ (next << 3);
}
function takesLong(count: number): number {
  let sum = count;
${Array.from({ length: 30_000 }, (_, index) => `  sum = mixes(sum, ${index});\n`).join("")}  return sum;
}
console.log(takesLong(process.argv.length));
`;
// The last line that the phase log prints before the stage that compiles function by function.
const functionsComeNext = "| write what Facts found |";

describe("compile/aot/a build that stops says where", () => {
  const folder = String(tempDir("aot-a-build-that-stops", { "program.ts": program, "takes-long.ts": takesLong }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const carrier = withoutDebugInformation();
  const command = (file: string) =>
    withoutCoreDump([
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...carrier,
      join(folder, file),
      "--outfile",
      join(folder, file.replace(".ts", isWindows ? ".exe" : "")),
    ]);
  const environment = { ...bunEnv, ...withoutCrashReport };

  async function endWhileItCompiles(signal: NodeJS.Signals) {
    const start = performance.now();
    await using build = Bun.spawn({
      cmd: command("takes-long.ts"),
      cwd: folder,
      env: { ...environment, [buildEnvironment.logsPhaseTimes]: "1" },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      timeout: 240_000,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let isEnded = false;
    const decoder = new TextDecoder();
    for await (const chunk of build.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      if (isEnded || !stderr.includes(functionsComeNext)) continue;
      isEnded = true;
      // The threads take their first functions a moment after that line. How long that moment and the stage last depends on this Bun and this machine, like the time so far.
      await Bun.sleep((performance.now() - start) / 20);
      build.kill(signal);
    }
    await build.exited;
    return { stderr, signal: build.signalCode };
  }

  test("a build that reaches its end says nothing of the kind", async () => {
    const build = await spawned(command("program.ts"), folder, environment);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/Stopped while|Still compiling/),
      exitCode: 0,
    });
  }, 300_000);

  // Any thread gets such a signal, so what that thread compiles is no hint.
  test.skipIf(!isASAN || isWindows)(
    "a build that another process ends by SIGILL says who sent it",
    async () => {
      expect(await endWhileItCompiles("SIGILL")).toEqual({
        stderr: expect.stringContaining(`Signal 4 was sent by process ${process.pid}.\n`),
        signal: "SIGILL",
      });
    },
    300_000,
  );

  // On Windows a process that another one ends runs nothing more. Ctrl+C in a console does reach it, and no test has a console.
  test.skipIf(isWindows).each(["SIGINT", "SIGTERM", "SIGQUIT"] as const)(
    "a build that takes long, ended by %s, says what it is still compiling",
    async signal => {
      expect(await endWhileItCompiles(signal)).toEqual({
        stderr: expect.stringMatching(/^Still compiling .+ in (walk|sweep|emit|allocate|encode)\.$/m),
        signal,
      });
    },
    300_000,
  );
});
