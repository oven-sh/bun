import { bunEnv } from "harness";
import { endAtMemoryLimitTogether, memoryLimitOfCommandsAtOnce } from "./memory-limit";

const { watch } = endAtMemoryLimitTogether();

/** Runs a command to its end. */
export async function run(cmd: string[], cwd?: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  using held = watch(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (held.exceeded)
    throw new Error(
      `KILLED: the commands that ran at once held more than ${(memoryLimitOfCommandsAtOnce / 2 ** 30).toFixed(1)} GB together. Run fewer of them at once: ${cmd.join(" ")}`,
    );
  return { stdout, stderr, exitCode };
}
