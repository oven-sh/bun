// scratch stand-in of test/harness.ts: `bunExe` is the probe of the planned command
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
export const bunExe = () => process.env.LINT_PROBE ?? "/tmp/td-probe/out/tsentry";
export const bunEnv: NodeJS.Dict<string> = { ...process.env, ASAN_OPTIONS: "detect_leaks=0" };
export function tempDir(prefix: string, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), prefix + "-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return { toString: () => dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}
