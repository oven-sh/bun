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
import { chmod, copyFile, cp, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadable } from "node:stream/web";
import { BuildError, assert } from "./error.ts";

// On Windows, prefer the OS-shipped bsdtar. Git-for-Windows / MSYS put GNU tar
// earlier in PATH, and GNU tar parses `C:\...` as an rsh `host:path` spec
// ("Cannot connect to C: resolve failed"). System32 always has bsdtar on
// Windows 10 1803+; if SystemRoot is somehow unset, fall back to PATH lookup.
const tarExe =
  process.platform === "win32" && process.env.SystemRoot
    ? resolve(process.env.SystemRoot, "System32", "tar.exe")
    : "tar";

/**
 * Read-only prefetch cache baked into CI images by `scripts/prefetch-deps.ts`
 * (run from bootstrap.{sh,ps1} at image-bake time). When set, downloads check
 * here first and copy on hit instead of hitting the network.
 *
 * Layout:
 *   <prefetchDir>/by-url/<sha256(url)[:32]>   raw downloaded bytes (any URL)
 *   <prefetchDir>/extracted/<basename(dest)>/ pre-extracted prebuilt trees
 *                                             (.identity / .zig-commit inside)
 *
 * Both are content-addressed — a dep version bump changes the URL/identity, so
 * stale prefetch entries are simply not found and the build falls through to
 * the network. No image rebuild needed when versions change; the baked cache
 * just becomes a partial hit until the image is next refreshed.
 *
 * Resolved from `BUN_BUILD_PREFETCH_DIR` if set, else the platform's
 * well-known bake path. The fallback is what makes this robust on CI: getting
 * an env var from image-bake time into a Buildkite job's shell crosses
 * systemd / non-login-shell / agent-hook boundaries that vary per platform,
 * whereas "look at the path bootstrap writes to" doesn't.
 */
export const prefetchDir: string | undefined = (() => {
  const env = process.env.BUN_BUILD_PREFETCH_DIR;
  if (env) return env;
  const wellKnown = process.platform === "win32" ? "C:\\bun-prefetch" : "/opt/bun-prefetch";
  return existsSync(wellKnown) ? wellKnown : undefined;
})();

/**
 * Path under `<dir>/by-url/` for a given download URL. The optional `dir`
 * lets the warm-cache producer (prefetch-deps.ts) compute the same key
 * without relying on the module-level env snapshot above.
 */
export function prefetchPathForUrl(url: string, dir = prefetchDir): string | undefined {
  if (dir === undefined) return undefined;
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return resolve(dir, "by-url", key);
}

/**
 * If `prefetchDir/extracted/<basename(dest)>/<stampFile>` matches `expected`,
 * copy that tree to `dest` and return true. Used by fetchPrebuilt/fetchZig to
 * skip download+extract entirely when the image has the right version baked.
 *
 * Recursive copy (not symlink) so the per-build cacheDir stays self-contained
 * and writable; the prefetch tree may be read-only.
 */
export async function tryPrefetchExtracted(dest: string, stampFile: string, expected: string): Promise<boolean> {
  if (prefetchDir === undefined) return false;
  const src = resolve(prefetchDir, "extracted", basename(dest));
  const stamp = resolve(src, stampFile);
  if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== expected) return false;
  console.log(`using prefetch cache: ${src}`);
  // Stage-then-rename so an interrupted copy doesn't leave a stamped-but-
  // incomplete tree at dest (same publish discipline as fetchPrebuilt).
  const staging = `${dest}.${process.pid}.prefetch`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(resolve(dest, ".."), { recursive: true });
  try {
    await cp(src, staging, { recursive: true });
    // cp preserves source modes, and bootstrap chmod's the prefetch dir
    // read-only. Restore u+w on the copy so a future version bump can
    // `rm -rf dest` (force only suppresses ENOENT, not EACCES on a 555 dir).
    await chmodRecursiveWritable(staging);
    await rm(dest, { recursive: true, force: true });
    await rename(staging, dest);
  } finally {
    // Best-effort: staging may still have 555 dirs if chmod failed partway.
    await chmodRecursiveWritable(staging).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return true;
}

async function chmodRecursiveWritable(root: string): Promise<void> {
  // lstat: cp copies symlinks as-is; following them would ENOENT on a
  // dangling link or recurse outside staging via a dir symlink.
  const st = await lstat(root);
  if (st.isSymbolicLink()) return;
  await chmod(root, st.mode | 0o200);
  if (!st.isDirectory()) return;
  for (const e of await readdir(root)) await chmodRecursiveWritable(resolve(root, e));
}

/**
 * Download a URL to a file with retry. Atomic: temp file → rename on success.
 *
 * Checks `prefetchDir/by-url/` first — on a CI image with a warm prefetch
 * cache the network is never touched for matching URLs.
 *
 * @param logPrefix Shown in progress/retry messages: `[<logPrefix>] retry 2/5`
 */
export async function downloadWithRetry(url: string, dest: string, logPrefix: string): Promise<void> {
  const prefetched = prefetchPathForUrl(url);
  if (prefetched !== undefined && existsSync(prefetched)) {
    console.log(`using prefetch cache: ${prefetched}`);
    await mkdir(resolve(dest, ".."), { recursive: true });
    // Same temp-then-rename atomicity as the network path below — an
    // interrupted copy must not leave a partial file claiming to be complete.
    const tmp = `${dest}.${process.pid}.partial`;
    await copyFile(prefetched, tmp);
    await rename(tmp, dest);
    return;
  }

  const maxAttempts = 5;
  let lastError: unknown;
  let permanent = false;

  for (let attempt = 1; attempt <= maxAttempts && !permanent; attempt++) {
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
        // 4xx is deterministic — a bad URL/missing artifact won't succeed on
        // retry. Only loop on 5xx/network where the CDN may recover.
        permanent = res.status >= 400 && res.status < 500;
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
    }
  }

  // 4xx: throw the status error directly — wrapping it in "after N attempts"
  // is misleading (we only made one), and callers (prefetch-deps.ts) need to
  // distinguish 404 from transient failures by message.
  if (permanent) throw lastError;

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

  const result = spawnSync(tarExe, args, {
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
  const tarResult = spawnSync(tarExe, ["-xmf", zipPath, "-C", dest], {
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

  // ─── Prefetch cache: pre-extracted tree with matching identity? ───
  if (await tryPrefetchExtracted(dest, ".identity", identity)) return;

  console.log(`fetching ${url}`);

  // Process-unique temp paths so concurrent builds (shared cacheDir across
  // checkouts) can't stomp each other's download/extraction.
  const suffix = `.${process.pid}.${Date.now().toString(36)}`;

  // ─── Download ───
  const destParent = resolve(dest, "..");
  await mkdir(destParent, { recursive: true });
  const tarballPath = `${dest}${suffix}.tar.gz`;
  await downloadWithRetry(url, tarballPath, name);

  // ─── Extract ───
  // Extract to a private staging dir, then hoist. We don't extract directly
  // into dest/ because the tarball's top-level dir name is unpredictable
  // (e.g. `bun-webkit/` vs `libfoo-1.2.3/`).
  const stagingDir = `${dest}${suffix}.staging`;
  await mkdir(stagingDir, { recursive: true });

  try {
    // stripComponents=0: keep top-level dir for hoisting.
    await extractTarGz(tarballPath, stagingDir, 0);
    await rm(tarballPath, { force: true });

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
    await rm(tarballPath, { force: true });
  }
}
