import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";

/**
 * The bytes of an executable and, behind them, the strings that its images store. A text that an image only shows, such as
 * the name of a function, is coded: its characters do not stand in the file.
 */
export function bytesAndStoredStrings(executable: string): Buffer {
  // The command takes no other flag, not from the environment either.
  const { BUN_OPTIONS: _, ...env } = bunEnv;
  const printed = Bun.spawnSync({ cmd: [bunExe(), "build", "--aot-stored-strings", executable], env });
  const report = printed.stderr.toString();
  // An executable built without --aot holds no image.
  if (!printed.stdout.length && !report.includes("holds no image"))
    throw new Error(`no stored strings of ${executable}: ${report}`);
  return Buffer.concat([readFileSync(executable), printed.stdout]);
}
