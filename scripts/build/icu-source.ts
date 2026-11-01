/**
 * ICU's sources for deps/icu.ts: the release tarball, with the patches oven-sh/WebKit keeps in icu/, in the build cache.
 *
 * The tarball and not the repository, which has no built data (source/data/in/icudt<NN>l.dat).
 *
 * Configure fetches it, at the same time as WebKit (webkit-source.ts): deps/icu.ts reads which files to compile out of
 * ICU's own sources.txt lists, and the patches come with the WebKit tree, which is also what names the directory.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadWithRetry, extractTarGz } from "./download.ts";
import { BuildError } from "./error.ts";
import { applyPatch } from "./fetch-cli.ts";

/** What icu/source.json of the pinned WebKit says. Written here too so that both are fetched at once; configure compares them. */
export const ICU_VERSION = "79.1";
const ICU_SHA256 = "06fa63ecb521048f8082f12ad988f6b678d90cbd88aafce24cbc94902b191d99";

/**
 * What zstd's search for the best dictionary (`--train-cover` by itself) settles on for this version's data. Given them
 * it trains the same dictionary in 6 seconds; the search takes 5 minutes of CPU. `icu-data.ts --cover=search` prints them.
 */
export const ICU_DICTIONARY_COVER = "k=290,d=6";

export const ICU_URL = `https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz`;

const patches = ["udata-decompress-hook.patch", "decnum-allocation-failure.patch"];

const STAMP = ".ref";

export function icuSourceDir(cacheDir: string, webkitVersion: string): string {
  const webkit = webkitVersion.startsWith("autobuild-")
    ? webkitVersion.slice("autobuild-".length)
    : webkitVersion.slice(0, 16);
  return resolve(cacheDir, `icu-source-${ICU_VERSION}-webkit-${webkit}`);
}

/** The tarball, downloaded if need be. `$BUN_ICU_SOURCES` names one that is on this machine already. */
async function tarball(cacheDir: string): Promise<string> {
  const path = process.env.BUN_ICU_SOURCES || join(cacheDir, "tarballs", `icu4c-${ICU_VERSION}-sources.tgz`);
  if (!existsSync(path)) {
    await mkdir(join(cacheDir, "tarballs"), { recursive: true });
    await downloadWithRetry(ICU_URL, path, "icu");
  }
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha256 !== ICU_SHA256) {
    throw new BuildError(`${path} has the sha256 ${sha256}, not ${ICU_SHA256}`, { hint: "Delete it and build again" });
  }
  return path;
}

/**
 * `webkitReady` resolves once the WebKit tree is there. Does nothing for a build that does not compile ICU, or that
 * compiles one of yours (`--local-deps=icu=<path>`).
 */
export async function ensureIcuSource(
  cfg: { cacheDir: string; webkitVersion: string; localDeps: Record<string, string> },
  webkitReady: Promise<void>,
): Promise<void> {
  const dir = cfg.localDeps.icu;
  if (dir === undefined || dir !== icuSourceDir(cfg.cacheDir, cfg.webkitVersion)) return;
  if (existsSync(join(dir, STAMP))) return;

  const started = Date.now();
  console.log(`[icu] fetching ICU ${ICU_VERSION}`);
  const staging = `${dir}.${process.pid}.${Date.now().toString(36)}.staging`;
  try {
    await mkdir(staging, { recursive: true });
    await extractTarGz(await tarball(cfg.cacheDir), staging);

    await webkitReady;
    const fork = join(cfg.localDeps.WebKit!, "icu");
    const pinned = JSON.parse(readFileSync(join(fork, "source.json"), "utf8")) as { version: string; sha256: string };
    if (pinned.version !== ICU_VERSION || pinned.sha256 !== ICU_SHA256) {
      throw new BuildError(`This WebKit is built with ICU ${pinned.version}, not ${ICU_VERSION}`, {
        file: import.meta.filename,
        hint: `Set ICU_VERSION and ICU_SHA256 to what ${join(fork, "source.json")} says`,
      });
    }
    for (const patch of patches) applyPatch(staging, join(fork, patch), readFileSync(join(fork, patch), "utf8"));

    await writeFile(join(staging, STAMP), `${ICU_VERSION}\n`);
    await rm(dir, { recursive: true, force: true });
    try {
      await rename(staging, dir);
    } catch (err) {
      // Another build got there first.
      if (!existsSync(join(dir, STAMP))) throw err;
    }
    console.log(`[icu] extracted to ${dir} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
