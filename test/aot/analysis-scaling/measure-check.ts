import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { memoryLimit } from "../harness/memory-limit";
import { measureHere, notCounted, sayOnce, type Measured } from "./measure-here";

export { openInstructionCounter } from "./measure-here";

export type Cost = { instructions?: number; peakBytes: number };

const killAfterMilliseconds = 60_000;

let bundle: Promise<string> | undefined;
/** ./measure-here.ts with what it imports. A process that is handed its text reads none of the folders above this file to find it. */
const textOfMeasureHere = () =>
  (bundle ??= Bun.build({ entrypoints: [join(import.meta.dir, "measure-here.ts")], target: "bun" }).then(built =>
    built.outputs[0].text(),
  ));

function accepted(command: string[], expectedExitCode: number, run: Measured) {
  const { instructions, peakBytes, stdout, stderr, exitCode, signalCode, exceededMemoryLimit } = run;
  if (exceededMemoryLimit)
    throw new Error(`${command.join(" ")}: killed at its memory limit of ${Math.round(memoryLimit / 2 ** 20)} MB`);
  if (exitCode !== expectedExitCode)
    throw new Error(`${command.join(" ")}: exit code ${exitCode}, signal ${signalCode}\n${stdout}${stderr}`);
  return { instructions, peakBytes, stdout, stderr };
}

export const measureCheck = (cwd: string, args: string[]) =>
  measureCommandWithMemory(cwd, [bunExe(), "check", "--aot", ...args]);

/** The instructions that the command and its children execute in user mode, on all their threads. */
export async function measureCommand(
  cwd: string,
  command: string[],
  killAfter = killAfterMilliseconds,
  env: Record<string, string | undefined> = bunEnv,
  expectedExitCode = 0,
): Promise<{ instructions?: number; stdout: string; stderr: string }> {
  const { instructions, stdout, stderr } = accepted(
    command,
    expectedExitCode,
    await measureHere(cwd, command, killAfter, env),
  );
  return { instructions, stdout, stderr };
}

/**
 * As `measureCommand`, and the most memory that the command has resident at a time.
 *
 * On Linux a process begins with the peak of the process that started it: `ru_maxrss` survives exec. A command that the test runner starts itself never
 * reads less than the most that the runner has held so far, which is more the more tests of a file have run. So a Bun process that has done nothing else
 * starts the command: what it hands down is some 40 MB, less than any build takes.
 */
export async function measureCommandWithMemory(
  cwd: string,
  command: string[],
  killAfter = killAfterMilliseconds,
  env: Record<string, string | undefined> = bunEnv,
  expectedExitCode = 0,
): Promise<Cost & { stdout: string; stderr: string }> {
  if (process.platform !== "linux")
    return accepted(command, expectedExitCode, await measureHere(cwd, command, killAfter, env));
  await using parent = Bun.spawn({
    cmd: [bunExe(), "-e", await textOfMeasureHere(), JSON.stringify([cwd, command, killAfter, env])],
    cwd,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: killAfter + 30_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([parent.stdout.text(), parent.stderr.text(), parent.exited]);
  if (exitCode !== 0)
    throw new Error(
      `${command.join(" ")}: what measures it ended with exit code ${exitCode}, signal ${parent.signalCode}\n${stdout}${stderr}`,
    );
  for (const line of stderr.split("\n")) if (line.startsWith(notCounted)) sayOnce(line);
  return accepted(command, expectedExitCode, JSON.parse(stdout));
}

export async function measureLeast(cwd: string, args: string[], runs: number): Promise<Cost> {
  const all: Cost[] = [];
  for (let run = 0; run < runs; run++) all.push(await measureCheck(cwd, args));
  const counted = all.flatMap(cost => cost.instructions ?? []);
  return {
    instructions: counted.length === runs ? Math.min(...counted) : undefined,
    peakBytes: Math.min(...all.map(cost => cost.peakBytes)),
  };
}
