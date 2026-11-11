import { bunEnv } from "harness";
import { describeKill } from "./killed-for-memory";
import { endAtMemoryLimitTogether } from "./memory-limit";
import { reportsToTheRunnerAlone, throughAtOnce } from "./without-core-dump";

const { watch } = endAtMemoryLimitTogether();

/** Runs a command to completion. With `limit`, kills it after that many milliseconds and returns what it printed so far. */
export async function run(
  cmd: string[],
  cwd?: string,
  env: Record<string, string | undefined> = bunEnv,
  limit?: number,
) {
  await using proc = Bun.spawn({
    cmd: throughAtOnce(cmd),
    cwd,
    env: reportsToTheRunnerAlone(env),
    stdout: "pipe",
    stderr: "pipe",
    ...(limit && { timeout: limit, killSignal: "SIGKILL" as const }),
  });
  using held = watch(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (held.exceeded) throw new Error(describeKill(held.held, cmd));
  return { stdout, stderr, exitCode };
}
