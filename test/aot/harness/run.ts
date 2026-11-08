import { bunEnv } from "harness";
import { describeKill } from "./killed-for-memory";
import { endAtMemoryLimitTogether } from "./memory-limit";
import { reportsToTheRunnerAlone, throughAtOnce } from "./without-core-dump";

const { watch } = endAtMemoryLimitTogether();

/** Runs a command to its end. */
export async function run(cmd: string[], cwd?: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: throughAtOnce(cmd),
    cwd,
    env: reportsToTheRunnerAlone(env),
    stdout: "pipe",
    stderr: "pipe",
  });
  using held = watch(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (held.exceeded) throw new Error(describeKill(held.held, cmd));
  return { stdout, stderr, exitCode };
}
