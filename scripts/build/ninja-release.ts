/**
 * The ninja that runs the build.
 *
 * Bun's graph builds with any ninja, but it is written for oven-sh/ninja (the `bun` branch of the fork;
 * its bun/README.md lists what it adds to upstream). What matters here is `early_output_prefix`: a
 * crate is one edge and one rustc, and that ninja starts a crate's dependents when rustc has written
 * the `.rmeta` instead of when it exits (rust/emit.ts). A stock ninja builds the same graph without
 * that overlap.
 *
 * The fork publishes every commit as the release `bun-ninja-<sha8>`: one archive per build host and
 * `bun-ninja.json` with their checksums. The release and the checksums are pinned below; the build
 * driver (scripts/build.ts) fetches the host's archive once into the shared build cache and runs it.
 * It is fetched by the driver, not by an edge, because it is what runs the edges — and not at
 * configure, which never fetches.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractZip } from "./download.ts";

/**
 * To bump: pick a release of https://github.com/oven-sh/ninja/releases and copy `tag` and each
 * archive's `sha256` from its bun-ninja.json.
 */
export const ninjaRelease = {
  tag: "bun-ninja-1c3c9adb",
  /** `<os>-<arch>` of the machine running the build → sha256 of `bun-ninja-<os>-<arch>.zip` */
  sha256: {
    "linux-x64": "4bf2b3be90c635066309176ce930b5ede7107aeb764d9885e7dbb21810f54644",
    "linux-aarch64": "69fda78c1cd4f839ce9648a7ace0e9d32180dcf68b3e82487b2f2bf7eb40b8b1",
    "darwin-x64": "b098a2dcb0d716d6802201663c4be7d0e9fcabd16b005da43e671a92d1971c3d",
    "darwin-aarch64": "c90dc225e48760fc91cade8baf20892a53b7a0a9ac1bcc407f08acea1451e896",
    "windows-x64": "1b38befdceaa279d54e1d8b09cc986a27dbd0325dd1f528101a0855c4135e74c",
    "windows-aarch64": "3c6de27e4fe068955e7890f22f2847bb89b4a21b7dd58a36d333e0f194d37302",
  } as Record<string, string>,
};

/** Where the pinned ninja lives once fetched: `<cacheDir>/ninja/<tag>/ninja[.exe]`. */
export function pinnedNinjaPath(cfg: Config): string {
  return join(cfg.cacheDir, "ninja", ninjaRelease.tag, `ninja${cfg.host.exeSuffix}`);
}

/**
 * The ninja to run: the pinned oven-sh/ninja, fetched if this is its first use on the machine — or `ninja`
 * from PATH when there is no release for this host or it cannot be fetched (offline, a mirror-less CI
 * sandbox). The fallback builds the same graph, only without starting crates before their dependencies'
 * rustc has exited.
 */
export async function resolveNinja(cfg: Config): Promise<string> {
  const path = pinnedNinjaPath(cfg);
  if (existsSync(path)) return path;

  const host = `${cfg.host.os}-${cfg.host.arch}`;
  const sha256 = ninjaRelease.sha256[host];
  if (sha256 === undefined) return "ninja"; // no release for this host (FreeBSD)

  const archive = `bun-ninja-${host}.zip`;
  const url = `https://github.com/oven-sh/ninja/releases/download/${ninjaRelease.tag}/${archive}`;
  // Process-unique scratch next to the destination: concurrent builds share the cache directory.
  const scratch = `${join(cfg.cacheDir, "ninja", ninjaRelease.tag)}.${process.pid}.tmp`;
  try {
    await mkdir(scratch, { recursive: true });
    const zip = join(scratch, archive);
    // Two tries, not the dependency downloads' ten: failing here costs only the pipelining, and an offline
    // machine should not wait through a long backoff at the start of every build.
    await downloadWithRetry(url, zip, "ninja", { attempts: 2, backoffMs: () => 1000 });
    const actual = createHash("sha256")
      .update(await readFile(zip))
      .digest("hex");
    if (actual !== sha256) throw new Error(`${archive}: sha256 is ${actual}, expected ${sha256}`);
    await extractZip(zip, scratch);
    await rm(zip);
    await chmod(join(scratch, `ninja${cfg.host.exeSuffix}`), 0o755);
    await mkdir(join(cfg.cacheDir, "ninja"), { recursive: true });
    try {
      await rename(scratch, join(cfg.cacheDir, "ninja", ninjaRelease.tag));
    } catch (e) {
      // another build published the same release first
      if (!existsSync(path)) throw e;
    }
    return path;
  } catch (e) {
    process.stderr.write(
      `note: could not fetch ${ninjaRelease.tag} (${(e as Error).message}); building with the ninja on PATH, without Rust pipelining\n`,
    );
    return "ninja";
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
