// A check that starts the command as the default check does and records what it printed. Scratch file, beside a copy of the runner.
import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { toRealPath } from "./runner/materialise";
import { getNormalizedAbsolutePath } from "./runner/tspath";

const bin = process.env.CAPTURE_BIN!;
const out = process.env.CAPTURE_OUT!;
export default async function check(input: any) {
  const root = realpathSync.native(resolve(input.root));
  const currentDirectory = getNormalizedAbsolutePath(input.currentDirectory, "/");
  const operands = input.rootFiles.map((name: string) => toRealPath(root, getNormalizedAbsolutePath(name, currentDirectory)));
  const cwd = realpathSync.native(toRealPath(root, currentDirectory));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" });
  delete env.FORCE_COLOR;
  delete env.BUN_OPTIONS;
  const proc = Bun.spawn({ cmd: [bin, "--lint", ...operands], cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  appendFileSync(
    out,
    JSON.stringify({
      name: input.instance.name,
      kind: input.instance.oracle?.class,
      operands: input.rootFiles,
      exitCode: proc.exitCode,
      signal: proc.signalCode,
      stdout,
      stderr,
    }) + "\n",
  );
  return { diagnostics: [] };
}
