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
  const { status, stdout, stderr } = child_process.spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf-8",
    ...options,
  });
  return {
    exitCode: status ?? 1,
    stdout,
    stderr,
  };
}
