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
 * `bun-ninja.json` with their checksums. The release and the checksums are pinned in
 * ci-images/spec.ts (`pins.bunNinja`), which also bakes that release into every CI image
 * (`locations.bunNinja`). On a machine without it the build driver (scripts/build.ts) fetches the
 * host's archive once into the shared build cache. It is fetched by the driver, not by an edge,
 * because it is what runs the edges — and not at configure, which never fetches.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { locations, pins } from "./ci-images/spec.ts";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractZip } from "./download.ts";

const release = pins.bunNinja;

/** Where a CI image has the pinned ninja (the `bunNinja` tool of ci-images/spec.ts); undefined for a host no image is baked for. */
function bakedNinjaPath(cfg: Config): string | undefined {
  const dir = (locations.bunNinja as Record<string, string>)[cfg.host.os];
  return dir === undefined ? undefined : join(dir, `ninja${cfg.host.exeSuffix}`);
}

/** Where the pinned ninja lives once fetched: `<cacheDir>/ninja/<tag>/ninja[.exe]`. */
function fetchedNinjaPath(cfg: Config): string {
  return join(cfg.cacheDir, "ninja", release.tag, `ninja${cfg.host.exeSuffix}`);
}

/** The pinned ninja already on this machine: the image's, else a previously fetched one. */
function presentNinja(cfg: Config): string | undefined {
  const baked = bakedNinjaPath(cfg);
  if (baked !== undefined && existsSync(baked)) return baked;
  const fetched = fetchedNinjaPath(cfg);
  return existsSync(fetched) ? fetched : undefined;
}

/**
 * The ninja for anything that operates on a build directory without being the build itself (configure's
 * `-t restat`, helper scripts): the pinned one if it is on the machine, the PATH one otherwise — never a fetch.
 * It has to be the same ninja the driver runs: ninja versions disagree on the `.ninja_log` format, and one
 * that finds a log it considers too old or too new rewrites or deletes it, which makes the next build a full one.
 */
export function ninjaIfPresent(cfg: Config): string {
  return presentNinja(cfg) ?? "ninja";
}

/**
 * The ninja to run: the pinned oven-sh/ninja, from the CI image or fetched on its first use elsewhere — or `ninja`
 * from PATH when there is no release for this host or it cannot be fetched (offline, a mirror-less CI
 * sandbox). The fallback builds the same graph, only without starting crates before their dependencies'
 * rustc has exited.
 */
export async function resolveNinja(cfg: Config): Promise<string> {
  const present = presentNinja(cfg);
  if (present !== undefined) return present;

  const path = fetchedNinjaPath(cfg);
  const host = `${cfg.host.os}-${cfg.host.arch}`;
  const sha256 = (release.sha256 as Record<string, string>)[host];
  if (sha256 === undefined) return "ninja"; // no release for this host (FreeBSD)

  const archive = `bun-ninja-${host}.zip`;
  const url = `https://github.com/oven-sh/ninja/releases/download/${release.tag}/${archive}`;
  // Process-unique scratch next to the destination: concurrent builds share the cache directory.
  const scratch = `${join(cfg.cacheDir, "ninja", release.tag)}.${process.pid}.tmp`;
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
      await rename(scratch, join(cfg.cacheDir, "ninja", release.tag));
    } catch (e) {
      // another build published the same release first
      if (!existsSync(path)) throw e;
    }
    return path;
  } catch (e) {
    process.stderr.write(
      `note: could not fetch ${release.tag} (${(e as Error).message}); building with the ninja on PATH, without Rust pipelining\n`,
    );
    return "ninja";
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
