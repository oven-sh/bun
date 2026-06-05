// Downloads and extracts the pinned CEF binary distribution for the current
// platform into native/.cef/<cef-platform>/.
//
//   bun scripts/fetch-cef.ts [--force]

import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { cefArchiveName, cefArchiveUrl, cefPlatform } from "./cef-version";

const PKG_ROOT = path.join(import.meta.dir, "..");
const CEF_DIR = path.join(PKG_ROOT, "native", ".cef");

export function cefRoot(): string {
  return path.join(CEF_DIR, cefPlatform());
}

export async function fetchCef(force = false): Promise<string> {
  const dest = cefRoot();
  if (existsSync(path.join(dest, "cmake", "FindCEF.cmake")) && !force) {
    console.log(`CEF already present at ${dest}`);
    return dest;
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(CEF_DIR, { recursive: true });

  const url = cefArchiveUrl();
  const archive = path.join(CEF_DIR, `${cefPlatform()}.tar.bz2`);
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  await Bun.write(archive, res);

  console.log(`Extracting ${archive}`);
  // bsdtar (windows) and GNU tar (linux/mac) both handle .tar.bz2.
  const proc = Bun.spawn({
    cmd: ["tar", "xjf", archive, "-C", CEF_DIR],
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("tar extraction failed");

  await rename(path.join(CEF_DIR, cefArchiveName()), dest);
  await rm(archive, { force: true });
  console.log(`CEF ready at ${dest}`);
  return dest;
}

if (import.meta.main) {
  await fetchCef(process.argv.includes("--force"));
}
