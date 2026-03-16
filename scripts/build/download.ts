/**
 * Download + archive extraction helpers.
 *
 * Used by the fetch CLIs in source.ts (dep tarballs), webkit.ts (prebuilt
 * tarball), zig.ts (compiler zip). Extracted because the retry + temp-then-
 * rename logic was copy-pasted three times and the platform-specific
 * extraction quirks (tar vs unzip, -m for mtime) were starting to drift.
 *
 * ## Retry behavior
 *
 * Exponential backoff (1s → 2s → 4s → 8s → cap at 30s), 5 attempts. GitHub
 * releases (our main source) are usually reliable, but CI sees transient
 * CDN failures often enough that no-retry means flaky builds. The cap at
 * 30s means worst-case we spend ~60s total before giving up.
 *
 * ## Atomic writes
 *
 * Download goes to `<dest>.partial`, renamed on success. If download is
 * interrupted (ctrl-c, network drop, OOM), no partial file claims to be
 * complete. Next build retries from scratch.
 *
 * ## Why not stream to disk
 *
 * We buffer the whole response in memory (`arrayBuffer()`) before writing.
 * For zig (~50MB) and dep tarballs (~few MB) this is fine. For WebKit
 * (~200MB) it's ~200MB peak memory. If that's ever a problem, switch to
 * `Bun.write(dest, res)` which streams. Haven't bothered because CI
 * machines have GBs of RAM and the whole download is a few seconds.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BuildError, assert } from "./error.ts";

/**
 * Download a URL to a file with retry. Atomic: temp file → rename on success.
 *
 * @param logPrefix Shown in progress/retry messages: `[<logPrefix>] retry 2/5`
 */
export async function downloadWithRetry(url: string, dest: string, logPrefix: string): Promise<void> {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      console.log(`retry ${attempt}/${maxAttempts} in ${backoffMs}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    try {
      const res = await fetch(url, { headers: { "User-Agent": "bun-build-system" } });
      if (!res.ok) {
        lastError = new BuildError(`HTTP ${res.status} ${res.statusText} for ${url}`);
        continue;
      }

      const tmpPath = `${dest}.partial`;
      await rm(tmpPath, { force: true });
      const buf = await res.arrayBuffer();
      await writeFile(tmpPath, new Uint8Array(buf));
      await rename(tmpPath, dest);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw new BuildError(`Failed to download after ${maxAttempts} attempts: ${url}`, {
    cause: lastError,
    hint: "Check network connectivity, or place the file manually at the destination path",
  });
}

/**
 * Extract a .tar.gz archive with mtime normalization.
 *
 * `--strip-components=1` removes the top-level dir (github archives always
 * have one: `<repo>-<commit>/`).
 *
 * `-m` sets extracted mtimes to NOW instead of the archive's stored mtimes.
 * This is CRITICAL for correct incremental builds: tarballs store commit-time
 * mtimes (e.g. 2023), so re-fetching at a new commit gives headers 2024-ish
 * mtimes — older than any .o we built yesterday. Downstream ninja staleness
 * checks miss the change entirely. With -m, everything extracted is "now",
 * so any .o built BEFORE this extraction is correctly stale.
 *
 * @param stripComponents How many top-level dirs to strip. 1 for github
 *   archives. 0 for tarballs that are already flat (e.g. prebuilt WebKit
 *   has `bun-webkit/` that the caller wants to keep for a rename step).
 */
export async function extractTarGz(tarball: string, dest: string, stripComponents = 1): Promise<void> {
  const args = ["-xzmf", tarball, "-C", dest];
  if (stripComponents > 0) args.push(`--strip-components=${stripComponents}`);

  const result = spawnSync("tar", args, {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });

  if (result.error) {
    throw new BuildError(`Failed to spawn tar`, {
      hint: "Is `tar` in your PATH? (macOS/linux ship it; Windows 10+ ships bsdtar as tar.exe)",
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new BuildError(`tar extraction failed (exit ${result.status}): ${result.stderr}`, { file: tarball });
  }

  const entries = await readdir(dest);
  assert(entries.length > 0, `tar extracted nothing from ${tarball}`, { hint: "Tarball may be corrupt" });
}

/**
 * Extract a .zip archive with mtime normalization.
 *
 * Tries `unzip` first (most systems), falls back to `tar` (bsdtar — what
 * Windows 10+ ships as tar.exe — handles .zip).
 *
 * `-DD` (unzip) / `-m` (tar) for the same mtime-fix as extractTarGz.
 *
 * Does NOT strip top-level dir — zip layouts vary, caller handles hoisting.
 */
export async function extractZip(zipPath: string, dest: string): Promise<void> {
  // unzip -o: overwrite, -DD: don't restore timestamps, -d: destination.
  const unzipResult = spawnSync("unzip", ["-o", "-DD", "-d", dest, zipPath], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (unzipResult.status === 0) return;

  // bsdtar auto-detects .zip. -m: don't preserve mtimes.
  const tarResult = spawnSync("tar", ["-xmf", zipPath, "-C", dest], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (tarResult.status === 0) return;

  throw new BuildError(
    `Failed to extract zip (tried unzip and tar):\n` +
      `  unzip: ${unzipResult.error?.message ?? `exit ${unzipResult.status}: ${unzipResult.stderr}`}\n` +
      `  tar: ${tarResult.error?.message ?? `exit ${tarResult.status}: ${tarResult.stderr}`}`,
    { file: zipPath, hint: "Install unzip: apt install unzip / brew install unzip" },
  );
}

/**
 * Fetch a prebuilt tarball: download + extract + write identity stamp.
 *
 * Generic mechanism for the `{ kind: "prebuilt" }` Source variant. Download a
 * tarball with pre-compiled libraries, extract to `dest/`, write `.identity`
 * stamp. On next fetch, if stamp matches, skip download (restat prunes).
 *
 * Tarball layout assumption: single top-level directory. We extract to a
 * staging dir, hoist the single child into `dest/`. Matches GitHub release
 * asset conventions (WebKit's `bun-webkit/`, future deps' similar layouts).
 * If a tarball has multiple top-level entries, the whole staging dir becomes
 * `dest/` (no hoist).
 *
 * @param identity Written to `dest/.identity`. Changing it triggers re-download.
 * @param rmPaths Paths (relative to `dest/`) to delete after extraction.
 *   Used to remove conflicting headers (WebKit's unicode/, nodejs's openssl/).
 *   Deleted via fs.rm — no shell, cross-platform.
 */
export async function fetchPrebuilt(
  name: string,
  url: string,
  dest: string,
  identity: string,
  rmPaths: string[] = [],
): Promise<void> {
  const stampPath = resolve(dest, ".identity");

  // ─── Short-circuit: already at this identity? ───
  if (existsSync(stampPath)) {
    const existing = readFileSync(stampPath, "utf8").trim();
    if (existing === identity) {
      console.log(`up to date`);
      return; // restat no-op
    }
    console.log(`identity changed (was ${existing.slice(0, 16)}, now ${identity.slice(0, 16)}), re-fetching`);
  }

  console.log(`fetching ${url}`);

  // ─── Download ───
  const destParent = resolve(dest, "..");
  await mkdir(destParent, { recursive: true });
  const tarballPath = `${dest}.download.tar.gz`;
  await downloadWithRetry(url, tarballPath, name);

  // ─── Extract ───
  // Wipe dest first — no stale files from a previous version.
  // Extract to staging dir, then hoist. We don't extract directly into dest/
  // because the tarball's top-level dir name is unpredictable (e.g.
  // `bun-webkit/` vs `libfoo-1.2.3/`).
  await rm(dest, { recursive: true, force: true });
  const stagingDir = `${dest}.staging`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  // stripComponents=0: keep top-level dir for hoisting.
  await extractTarGz(tarballPath, stagingDir, 0);
  await rm(tarballPath, { force: true });

  // Hoist: if single top-level dir, promote its contents to dest.
  // If multiple entries (unusual), the staging dir becomes dest.
  const entries = await readdir(stagingDir);
  assert(entries.length > 0, `tarball extracted nothing`, { file: url });
  const hoistFrom = entries.length === 1 ? resolve(stagingDir, entries[0]!) : stagingDir;
  await rename(hoistFrom, dest);
  await rm(stagingDir, { recursive: true, force: true });

  // ─── Post-extract cleanup ───
  // Before stamp so failure → next build retries. force:true → no error if
  // path already gone (idempotent re-fetch).
  for (const p of rmPaths) {
    await rm(resolve(dest, p), { recursive: true, force: true });
  }

  // ─── Write stamp ───
  // LAST — if anything above throws, no stamp means next build retries.
  await writeFile(stampPath, identity + "\n");
  console.log(`extracted to ${dest}`);
}
