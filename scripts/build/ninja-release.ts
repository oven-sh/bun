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
 * (`locations.bunNinja`). On a machine without it configure fetches the host's archive once into
 * the shared build cache, where it fetches the other things that have to exist before ninja runs
 * (the macOS SDK, the Windows sysroot). An edge cannot fetch it: it is what runs the edges.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { locations, pins } from "./ci-images/spec.ts";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractZip } from "./download.ts";
import { describeError } from "./error.ts";
import { formatElapsed, nameColor } from "./tty.ts";

/** All that finding the ninja needs: also what `mode: "codegen"` resolves. */
type NinjaConfig = Pick<Config, "host" | "cacheDir">;

const release = pins.bunNinja;

/** Where a CI image has the pinned ninja (the `bunNinja` tool of ci-images/spec.ts); undefined for a host no image is baked for. */
function bakedNinjaPath(cfg: NinjaConfig): string | undefined {
  const dir = (locations.bunNinja as Record<string, string>)[cfg.host.os];
  return dir === undefined ? undefined : join(dir, `ninja${cfg.host.exeSuffix}`);
}

/** Where the pinned ninja lives once fetched: `<cacheDir>/ninja/<tag>/ninja[.exe]`. */
function fetchedNinjaPath(cfg: NinjaConfig): string {
  return join(cfg.cacheDir, "ninja", release.tag, `ninja${cfg.host.exeSuffix}`);
}

/** The pinned ninja already on this machine: the image's, else a previously fetched one. */
function presentNinja(cfg: NinjaConfig): string | undefined {
  const baked = bakedNinjaPath(cfg);
  if (baked !== undefined && existsSync(baked)) return baked;
  const fetched = fetchedNinjaPath(cfg);
  return existsSync(fetched) ? fetched : undefined;
}

/**
 * Why `ninja` cannot be run here, or undefined if it can. A machine may refuse to run a program it does not know,
 * or one in that directory, and may change its mind later, so this is asked of the file on every configure rather
 * than once after fetching it.
 */
function whyNotRunnable(ninja: string): string | undefined {
  const probe = spawnSync(ninja, ["--version"], { stdio: "ignore", windowsHide: true });
  if (probe.error !== undefined) return describeError(probe.error);
  if (probe.signal !== null) return `killed by ${probe.signal}`;
  return probe.status === 0 ? undefined : `exited with ${probe.status}`;
}

/**
 * The ninja for anything that operates on a build directory without being the build itself (configure's
 * regen replay, helper scripts): the pinned one if it is on the machine, the PATH one otherwise — never a fetch.
 * It has to be the same ninja the driver runs: ninja versions disagree on the `.ninja_log` format, and one
 * that finds a log it considers too old or too new rewrites or deletes it, which makes the next build a full one.
 */
export function ninjaIfPresent(cfg: NinjaConfig): string {
  const present = presentNinja(cfg);
  return present !== undefined && whyNotRunnable(present) === undefined ? present : "ninja";
}

/**
 * The ninja to run: the pinned oven-sh/ninja, from the CI image or fetched on its first use elsewhere — or `ninja`
 * from PATH when there is no release for this host, it cannot be fetched (offline, a mirror-less CI sandbox), or
 * this machine will not run it. The fallback builds the same graph, only without starting crates before their dependencies'
 * rustc has exited.
 *
 * A fetch reports itself the way a prebuilt dependency's edge does (`[WebKit] fetching …`,
 * `[WebKit] extracted to …`), on stderr like those: stdout is the built program's under build-then-exec.
 */
export async function ensureNinja(cfg: NinjaConfig): Promise<string> {
  const say = (line: string) => process.stderr.write(`${nameColor("ninja", "[ninja]")} ${line}\n`);
  const pinned = presentNinja(cfg) ?? (await fetchNinja(cfg, say));
  if (pinned === undefined) return "ninja";
  const why = whyNotRunnable(pinned);
  if (why === undefined) return pinned;
  say(`${pinned} cannot run on this machine (${why}); building with the ninja on PATH, without Rust pipelining`);
  return "ninja";
}

/** Fetch the pinned release into the build cache. Undefined (after saying why) when that is not possible. */
async function fetchNinja(cfg: NinjaConfig, say: (line: string) => void): Promise<string | undefined> {
  const path = fetchedNinjaPath(cfg);
  const host = `${cfg.host.os}-${cfg.host.arch}`;
  const sha256 = (release.sha256 as Record<string, string>)[host];
  if (sha256 === undefined) return undefined; // no release for this host (FreeBSD)

  const started = performance.now();
  const archive = `bun-ninja-${host}.zip`;
  const url = `https://github.com/oven-sh/ninja/releases/download/${release.tag}/${archive}`;
  // Process-unique scratch next to the destination: concurrent builds share the cache directory.
  const scratch = `${join(cfg.cacheDir, "ninja", release.tag)}.${process.pid}.tmp`;
  try {
    say(`fetching ${url}`);
    await mkdir(scratch, { recursive: true });
    const zip = join(scratch, archive);
    // One try, given up after ten seconds, not the dependency downloads' ten tries: failing costs only the
    // pipelining, the next configure tries again, and a machine that cannot reach the release must not wait long
    // at the start of every build. (One try also means download.ts has nothing to log: its retry lines go to
    // stdout, which is the built program's.)
    await downloadWithRetry(url, zip, "ninja", { attempts: 1, backoffMs: () => 0 }, AbortSignal.timeout(10_000));
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
    say(`extracted to ${join(cfg.cacheDir, "ninja", release.tag)} (${formatElapsed(performance.now() - started)})`);
    return path;
  } catch (e) {
    say(
      `could not fetch ${release.tag} (${describeError(e)}); building with the ninja on PATH, without Rust pipelining`,
    );
    return undefined;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
