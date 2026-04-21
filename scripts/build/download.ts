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
 * ## Streaming to disk
 *
 * Response body is piped to the temp file via `pipeline()` rather than
 * buffered through `res.arrayBuffer()`. Under node on Windows arm64,
 * `arrayBuffer()` on multi-MB responses intermittently fastfails the
 * process (0xC0000409) — no exception, just gone. Streaming avoids the
 * large native allocation and keeps peak memory flat regardless of
 * tarball size (WebKit is ~200MB).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadable } from "node:stream/web";
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

    const tmpPath = `${dest}.${process.pid}.partial`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "bun-build-system" } });
      if (!res.ok || res.body === null) {
        lastError = new BuildError(`HTTP ${res.status} ${res.statusText} for ${url}`);
        continue;
      }

      // Cast: DOM ReadableStream vs node:stream/web ReadableStream — same
      // shape at runtime, different TS lib declarations.
      await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadable), createWriteStream(tmpPath));
      await rename(tmpPath, dest);
      return;
    } catch (err) {
      lastError = err;
      // Swallow cleanup errors: on Windows, AV/indexer can briefly lock the
      // partial; a failed unlink must not abort the retry loop. Next attempt's
      // createWriteStream truncates anyway.
      await rm(tmpPath, { force: true }).catch(() => {});
      // Concurrent writer won? With a shared BUN_DEPS_CACHE_PATH two agents
      // can race the same URL-hash-keyed tarball; on Windows the loser's
      // rename can EPERM if AV/indexer has the freshly-written dest open.
      // Callers only reach here after checking !existsSync(dest), so a file
      // appearing mid-call is the same content (same URL) — treat as done
      // instead of re-downloading 200MB on every retry.
      if (existsSync(dest)) {
        console.log(`${dest} now present (concurrent download won the race)`);
        return;
      }
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
 * Integrity probe: does `tar -tzf` walk the whole archive without error?
 *
 * Used to decide whether a cached tarball is itself bad vs. extraction
 * failed for environmental reasons (disk full, staging dir unwritable).
 * Listing reads and gunzips every block but writes nothing to disk, so it
 * isolates the archive from the destination. Anything other than a clean
 * non-zero exit — spawn failure (tar not found) or signal death (OOM
 * killer) — counts as "lists cleanly": can't judge the file, so don't
 * delete a possibly-shared artifact.
 */
export function tarballListsCleanly(tarball: string): boolean {
  const r = spawnSync("tar", ["-tzf", tarball], { stdio: "ignore" });
  return r.error !== undefined || r.signal !== null || r.status === 0;
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
 * @param identity Written to `dest/.identity`. A mismatch triggers
 *   re-extract; whether that also re-downloads depends on the URL-hash
 *   key below (for current deps, identity changes imply URL changes).
 * @param cache Directory for the downloaded tarball (keyed by URL hash —
 *   `identity` alone doesn't cover os/arch). Lets CI agents persist the
 *   ~200MB WebKit download across ephemeral runners (via
 *   `BUN_DEPS_CACHE_PATH`) while `dest` stays buildDir-relative so
 *   split-build artifact upload keeps working. Tarball is kept after
 *   extraction; a hit skips the download but still re-extracts.
 * @param rmPaths Paths (relative to `dest/`) to delete after extraction.
 *   Used to remove conflicting headers (WebKit's unicode/, nodejs's openssl/).
 *   Deleted via fs.rm — no shell, cross-platform.
 */
export async function fetchPrebuilt(
  name: string,
  url: string,
  dest: string,
  identity: string,
  cache: string,
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

  // Process-unique temp paths so concurrent builds (shared cacheDir across
  // checkouts) can't stomp each other's download/extraction.
  const suffix = `.${process.pid}.${Date.now().toString(36)}`;

  // ─── Download (with cache) ───
  // Keyed on URL hash — same scheme as fetchDep. `identity` is NOT a
  // sufficient key: WebKit's identity is version + abi suffix but the URL
  // also varies by os/arch, so identity-keyed cache would collide across
  // cross-arch agents sharing one BUN_DEPS_CACHE_PATH.
  await mkdir(cache, { recursive: true });
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const tarballPath = resolve(cache, `${name}-${urlHash}.tar.gz`);
  if (existsSync(tarballPath)) {
    console.log(`cached tarball ${tarballPath}`);
  } else {
    console.log(`fetching ${url}`);
    await downloadWithRetry(url, tarballPath, name);
  }

  // ─── Extract ───
  // Extract to a private staging dir, then hoist. We don't extract directly
  // into dest/ because the tarball's top-level dir name is unpredictable
  // (e.g. `bun-webkit/` vs `libfoo-1.2.3/`).
  const destParent = resolve(dest, "..");
  await mkdir(destParent, { recursive: true });
  const stagingDir = `${dest}${suffix}.staging`;
  await mkdir(stagingDir, { recursive: true });

  try {
    // stripComponents=0: keep top-level dir for hoisting.
    try {
      await extractTarGz(tarballPath, stagingDir, 0);
    } catch (err) {
      // Extraction failed. Distinguish a corrupt cached tarball from an
      // environment failure (ENOSPC on the staging disk, tar missing,
      // signal): `tar -tzf` walks the whole archive without writing
      // anything. If THAT also fails the tarball is bad — drop it so the
      // next run re-downloads instead of failing forever on the same
      // file. If it succeeds the tarball is fine; keep it (it may be a
      // shared 200MB artifact we'd otherwise re-fetch for no reason).
      // Swallow the rm rejection so the ORIGINAL extraction error is what
      // surfaces, not a secondary EACCES/EROFS from a read-only cache.
      if (!tarballListsCleanly(tarballPath)) {
        console.log(`dropping unreadable cached tarball ${tarballPath}`);
        await rm(tarballPath, { force: true }).catch(() => {});
      }
      throw err;
    }

    // Hoist: if single top-level dir, promote its contents to dest.
    // If multiple entries (unusual), the staging dir becomes dest.
    const entries = await readdir(stagingDir);
    assert(entries.length > 0, `tarball extracted nothing`, { file: url });
    const hoistFrom = entries.length === 1 ? resolve(stagingDir, entries[0]!) : stagingDir;

    // ─── Post-extract cleanup + stamp (inside staging) ───
    // Done BEFORE publish so the rename below is the single step that makes
    // a complete, stamped tree visible at dest.
    for (const p of rmPaths) {
      await rm(resolve(hoistFrom, p), { recursive: true, force: true });
    }
    await writeFile(resolve(hoistFrom, ".identity"), identity + "\n");

    // ─── Publish ───
    // Directory rename can't overwrite on any platform, so rm first. If a
    // concurrent fetch won the race, our rename fails — treat a matching
    // stamp at dest as success.
    try {
      await rm(dest, { recursive: true, force: true });
      await rename(hoistFrom, dest);
    } catch (err) {
      const landed = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : undefined;
      if (landed === identity) {
        console.log(`up to date (concurrent fetch won)`);
        return;
      }
      throw err;
    }

    console.log(`extracted to ${dest}`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    // Tarball stays in cache for the next runner.
  }
}
