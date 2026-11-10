import { bunEnv } from "harness";
import { describeKill } from "./killed-for-memory";
import { endAtMemoryLimitTogether } from "./memory-limit";
import { hasSmallHeap, saysWhereItIs } from "./where-a-child-is";
import { reportsToTheRunnerAlone, throughAtOnce } from "./without-core-dump";

const { watch } = endAtMemoryLimitTogether();

/** Runs a command to its end, or for `limit` milliseconds: then the command is killed, and what it has printed comes back. */
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
  // A program with a small heap fills it in a second or two. One that goes on for much longer says where its threads are.
  using _where = hasSmallHeap(env) ? saysWhereItIs(proc.pid, cmd) : undefined;
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (held.exceeded) throw new Error(describeKill(held.held, cmd));
  return { stdout, stderr, exitCode };
}
