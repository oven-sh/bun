import { expect } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "fs";
import { bunEnv, isMacOS, isWindows } from "harness";
import { join } from "path";
import { spawned } from "../run-programs";

export type SpawnResult = Awaited<ReturnType<typeof spawned>>;

/**
 * Writes `bytes` as a new executable file at `path`.
 * macOS kills an executable whose bytes no longer match its signature, and caches the signature of a file it has run.
 */
async function writeExecutable(path: string, bytes: Buffer) {
  rmSync(path, { force: true });
  writeFileSync(path, bytes);
  chmodSync(path, 0o755);
  if (isMacOS) expect((await spawned(["codesign", "--force", "--sign", "-", path], "/", bunEnv)).exitCode).toBe(0);
}

/** Runs `bytes` as an executable in `folder` and removes the file. */
export async function runCopy(
  folder: string,
  bytes: Buffer,
  env: Record<string, string | undefined>,
): Promise<SpawnResult> {
  const path = join(folder, isWindows ? "copy.exe" : "copy");
  try {
    await writeExecutable(path, bytes);
    return await spawned([path], folder, env);
  } finally {
    rmSync(path, { force: true });
  }
}
