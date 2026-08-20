import child_process from "child_process";
import { debug } from "./console";

export function spawn(
  cmd: string,
  args: string[],
  options: child_process.SpawnOptions = {},
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  debug("spawn", [cmd, ...args].join(" "));
  const { error, status, stdout, stderr } = child_process.spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf-8",
    ...options,
  });
  if (error) {
    debug("child_process.spawnSync failed", error);
  }
  // A process that could not be spawned (missing executable, missing cwd) has no
  // status and no output: report it as a failure whose stderr is the reason.
  return {
    exitCode: status ?? 1,
    stdout: stdout ?? "",
    stderr: stderr ?? error?.message ?? "",
  };
}
