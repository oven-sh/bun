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
  // bun-ninja-1c3c9adb must not be used: the upstream master it was built from skips an edge's recorded deps
  // when a restat input turns out unchanged, so an edited crate could stay stale for one build (fixed in the
  // fork by 5ecd883). Until that build is published there is no release for any host, and the PATH ninja runs.
  tag: "bun-ninja-5ecd8831",
  /** `<os>-<arch>` of the machine running the build → sha256 of `bun-ninja-<os>-<arch>.zip` */
  sha256: {} as Record<string, string>,
};

/** Where the pinned ninja lives once fetched: `<cacheDir>/ninja/<tag>/ninja[.exe]`. */
export function pinnedNinjaPath(cfg: Config): string {
  return join(cfg.cacheDir, "ninja", ninjaRelease.tag, `ninja${cfg.host.exeSuffix}`);
}

/**
 * The ninja for anything that operates on a build directory without being the build itself (configure's
 * `-t restat`, helper scripts): the pinned one if it has been fetched, the PATH one otherwise — never a fetch.
 * It has to be the same ninja the driver runs: ninja versions disagree on the `.ninja_log` format, and one
 * that finds a log it considers too old or too new rewrites or deletes it, which makes the next build a full one.
 */
export function ninjaIfFetched(cfg: Config): string {
  const path = pinnedNinjaPath(cfg);
  return existsSync(path) ? path : "ninja";
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
    await Promise.race([
      downloadWithRetry(url, zip, "ninja", { attempts: 2, backoffMs: () => 1000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 30 s")), 30_000).unref()),
    ]);
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
