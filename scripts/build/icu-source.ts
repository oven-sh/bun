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
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ICU_SHA256, ICU_URL, ICU_VERSION } from "./deps/icu.ts";
import { applyPatch, downloadWithRetry, extractTarGz, fetchIntoCache } from "./download.ts";
import { BuildError } from "./error.ts";
import { webkitVersionKey } from "./webkit-source.ts";

const patches = ["udata-decompress-hook.patch", "decnum-allocation-failure.patch"];

export function icuSourceDir(cacheDir: string, webkitVersion: string): string {
  return resolve(cacheDir, `icu-source-${ICU_VERSION}-webkit-${webkitVersionKey(webkitVersion)}`);
}

/**
 * `webkitReady` resolves once the WebKit tree is there. Does nothing for a build that does not compile ICU, or that
 * compiles one of yours (`--local-deps=icu=<path>`).
 */
export async function ensureIcuSource(
  cfg: { cacheDir: string; webkitVersion: string; localDeps: Record<string, string> },
  webkitReady: Promise<void>,
): Promise<void> {
  const dir = icuSourceDir(cfg.cacheDir, cfg.webkitVersion);
  if (cfg.localDeps.icu !== dir) return;
  await fetchIntoCache("icu", ICU_URL, dir, `${ICU_SHA256} ${patches.join(" ")}`, async staging => {
    const tarball = join(cfg.cacheDir, "tarballs", basename(ICU_URL));
    if (!existsSync(tarball)) {
      await mkdir(dirname(tarball), { recursive: true });
      await downloadWithRetry(ICU_URL, tarball, "icu");
    }
    const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    if (sha256 !== ICU_SHA256) {
      throw new BuildError(`${tarball} has the sha256 ${sha256}, not ${ICU_SHA256}`, {
        hint: "Delete it and build again",
      });
    }
    await extractTarGz(tarball, staging);

    await webkitReady;
    const fork = join(cfg.localDeps.WebKit!, "icu");
    const pinned = JSON.parse(readFileSync(join(fork, "source.json"), "utf8")) as { version: string; sha256: string };
    if (pinned.version !== ICU_VERSION || pinned.sha256 !== ICU_SHA256) {
      throw new BuildError(`This WebKit is built with ICU ${pinned.version}, not ${ICU_VERSION}`, {
        hint:
          `Set ICU_VERSION and ICU_SHA256 in scripts/build/deps/icu.ts to what ${join(fork, "source.json")} says, ` +
          `or link this WebKit's own ICU with --webkit=prebuilt`,
      });
    }
    for (const patch of patches) applyPatch(staging, join(fork, patch), readFileSync(join(fork, patch), "utf8"));
  });
}
