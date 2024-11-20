import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-ignore
export async function css(file: string, is_development: boolean): string {
  const { success, stdout, stderr } = await Bun.spawnSync({
    cmd: [process.execPath, "build", file, "--experimental-css", ...(is_development ? [] : ["--minify"])],
    cwd: import.meta.dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!success) throw new Error(stderr.toString("utf-8"));
  return stdout.toString("utf-8");
}
