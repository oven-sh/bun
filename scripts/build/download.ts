/**
 * Download + archive extraction helpers.
 *
 * Used by the fetch CLIs in source.ts (dep tarballs) and webkit.ts
 * (prebuilt tarball). Extracted because the retry + temp-then-rename
 * logic was copy-pasted several times and the platform-specific
 * extraction quirks (tar vs unzip, -m for mtime) were starting to drift.
 *
 * ## Retry behavior
 *
 * `downloadRetry`: 10 attempts, backoff doubling from 2s and capped at 30s,
 * so a download keeps trying through ~3 minutes of backoff (plus whatever
 * the failing attempts themselves take).
 *
 * The window is sized for github.com being unreachable from a CI agent, not
 * for one bad request. Every download starts at github.com (archives and
 * release assets both 302 from there), and every dep whose pin moved after
 * the CI images were baked misses the prefetch cache below, so each build
 * makes on the order of a hundred live github.com downloads (several deps at
 * any given time, plus WebKit, which is bumped more often than the images
 * are rebaked). The outages CI actually hits are agent-wide: every
 * github.com connection from one agent failing for 30s to over two minutes
 * while the rest of the build is fine. The previous 5 attempts / ~30s gave
 * up inside those and took a random build lane with them.
 *
 * 408/429 are retried along with 5xx and network errors; the other 4xx are
 * deterministic and fail immediately. Retry lines and the final error name
 * the underlying failure (`describeError`), since `fetch` itself only says
 * "fetch failed".
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
import { BuildError, assert, describeError } from "./error.ts";
import { formatElapsed } from "./tty.ts";

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
 *                                             (.identity inside)
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
 * If `prefetchDir/by-url/` holds `url`, copy it to `dest` and return true.
 * Temp-then-rename, same as the network path: an interrupted copy must not
 * leave a partial file claiming to be complete.
 */
async function tryPrefetchFile(url: string, dest: string): Promise<boolean> {
  const prefetched = prefetchPathForUrl(url);
  if (prefetched === undefined || !existsSync(prefetched)) return false;
  console.log(`using prefetch cache: ${prefetched}`);
  await mkdir(resolve(dest, ".."), { recursive: true });
  const tmp = `${dest}.${process.pid}.partial`;
  await copyFile(prefetched, tmp);
  await rename(tmp, dest);
  return true;
}

/**
 * If `prefetchDir/extracted/<basename(dest)>/<stampFile>` matches `expected`,
 * copy that tree to `dest` and return true. Used by fetchPrebuilt to
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

/** Retry schedule for one download. Sizing rationale: "Retry behavior" above. */
export interface RetryPolicy {
  /** Total tries, including the first. */
  attempts: number;
  /** Delay before try number `attempt` (2..attempts). */
  backoffMs(attempt: number): number;
}

export const downloadRetry: RetryPolicy = {
  attempts: 10,
  backoffMs: attempt => Math.min(1000 * 2 ** (attempt - 1), 30_000),
};

/**
 * Download a URL to a file with retry. Atomic: temp file → rename on success.
 *
 * Checks `prefetchDir/by-url/` first — on a CI image with a warm prefetch
 * cache the network is never touched for matching URLs.
 *
 * @param logPrefix Unused: under ninja, stream.ts already prefixes every line
 *   with the dep name.
 * @param retry Tests pass a schedule with no backoff to drive the full
 *   attempt count without sleeping through it.
 */
export async function downloadWithRetry(
  url: string,
  dest: string,
  logPrefix: string,
  retry: RetryPolicy = downloadRetry,
): Promise<void> {
  if (await tryPrefetchFile(url, dest)) return;

  const maxAttempts = retry.attempts;
  let lastError: unknown;
  let permanent = false;

  for (let attempt = 1; attempt <= maxAttempts && !permanent; attempt++) {
    if (attempt > 1) {
      const backoffMs = retry.backoffMs(attempt);
      console.log(`retry ${attempt}/${maxAttempts} in ${backoffMs}ms (${describeError(lastError)})`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    const tmpPath = `${dest}.${process.pid}.partial`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "bun-build-system" } });
      if (!res.ok || res.body === null) {
        lastError = new BuildError(`HTTP ${res.status} ${res.statusText} for ${url}`);
        // 4xx is deterministic (bad URL, missing artifact) and won't succeed
        // on retry, except 408/429, which are the server asking for exactly
        // that. Loop on those, 5xx, and network errors.
        permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
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

/** The tarball GitHub serves for a commit (or tag) of `repo`. */
export function githubArchiveUrl(repo: string, commit: string): string {
  return `https://github.com/${repo}/archive/${commit}.tar.gz`;
}

/**
 * Cache/prefetch key for a source tree produced by `gitArchive()`. Shaped as a
 * URL so it shares `by-url/` (and `prefetchPathForUrl`) with real downloads;
 * nothing ever requests it over HTTP.
 */
export function gitArchiveUrl(repo: string, commit: string, sparse: string[]): string {
  return `git+https://github.com/${repo}@${commit}?sparse=${sparse.join(",")}`;
}

/** Inverse of gitArchiveUrl; undefined for a plain download URL. */
export function parseGitArchiveUrl(url: string): { repo: string; commit: string; sparse: string[] } | undefined {
  const m = /^git\+https:\/\/github\.com\/([^@]+)@([^?]+)\?sparse=(.*)$/.exec(url);
  if (m === null) return undefined;
  return { repo: m[1]!, commit: m[2]!, sparse: m[3]!.split(",").filter(p => p.length > 0) };
}

/**
 * Produce a `.tar.gz` shaped like a GitHub source archive (one top-level dir)
 * from a shallow, blobless, sparse git fetch of `commit`: only the paths in
 * `sparse` (git sparse-checkout non-cone patterns) are downloaded. This is the
 * road for repositories GitHub refuses to serve `/archive/` tarballs for
 * (WebKit: HTTP 422) — the same repositories where a build wants a few
 * percent of the tree. GitHub serves any reachable commit by sha this way,
 * branch tip or not.
 *
 * Same prefetch lookup, retry schedule and temp-then-rename discipline as
 * `downloadWithRetry`. The tree is archived without `.git`, so what lands in
 * vendor/ is indistinguishable from an extracted GitHub archive.
 */
export async function gitArchive(
  repo: string,
  commit: string,
  sparse: string[],
  dest: string,
  retry: RetryPolicy = downloadRetry,
): Promise<void> {
  assert(sparse.length > 0, `gitArchive ${repo}: empty sparse set`);
  if (await tryPrefetchFile(gitArchiveUrl(repo, commit, sparse), dest)) return;

  const work = `${dest}.${process.pid}.git`;
  const top = `${basename(repo)}-${commit}`;
  const tree = resolve(work, top);
  await rm(work, { recursive: true, force: true });
  await mkdir(tree, { recursive: true });

  // http.lowSpeed*: a transfer that moves under 1 KB/s for 60 s is a stalled
  // connection — git aborts it with an error and the retry loop below takes
  // over, instead of the build hanging on a dead socket.
  const git = (args: string[], what: string, input?: string): { ok: boolean; stderr: string } => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "protocol.version=2",
        "-c",
        "advice.detachedHead=false",
        "-c",
        "http.lowSpeedLimit=1000",
        "-c",
        "http.lowSpeedTime=60",
        ...args,
      ],
      {
        cwd: tree,
        input,
        stdio: [input === undefined ? "ignore" : "pipe", "ignore", "pipe"],
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    if (result.error) {
      throw new BuildError(`Failed to spawn git ${what}`, { hint: "Is `git` in your PATH?", cause: result.error });
    }
    return { ok: result.status === 0, stderr: result.stderr };
  };
  const mustGit = (args: string[], what: string, input?: string): void => {
    const { ok, stderr } = git(args, what, input);
    if (!ok) throw new BuildError(`git ${what} failed in ${tree}:\n${stderr}`);
  };

  try {
    // autocrlf/longpaths: a Windows host must produce the same bytes as a
    // posix one (patches are authored against LF) and WebKit paths run deep.
    mustGit(["init", "-q"], "init");
    mustGit(["config", "core.autocrlf", "false"], "config");
    mustGit(["config", "core.longpaths", "true"], "config");
    mustGit(["remote", "add", "origin", `https://github.com/${repo}.git`], "remote add");
    mustGit(["sparse-checkout", "set", "--no-cone", "--stdin"], "sparse-checkout", sparse.join("\n") + "\n");

    // fetch brings the commit and its trees; checkout then asks origin for
    // exactly the blobs the sparse set selects. Both touch the network, so
    // both sit inside the retry loop; both are idempotent.
    let lastError = "";
    let done = false;
    for (let attempt = 1; attempt <= retry.attempts && !done; attempt++) {
      if (attempt > 1) {
        const backoffMs = retry.backoffMs(attempt);
        console.log(`retry ${attempt}/${retry.attempts} in ${backoffMs}ms (${lastError.trim().split("\n").pop()})`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
      const fetched = git(["fetch", "-q", "--depth=1", "--filter=blob:none", "--no-tags", "origin", commit], "fetch");
      if (!fetched.ok) {
        lastError = fetched.stderr;
        // A ref the server doesn't have is a bad pin, not a network blip.
        if (/couldn't find remote ref|not our ref|no such remote ref/i.test(lastError)) {
          throw new BuildError(`git fetch: ${repo} has no commit ${commit}\n${lastError}`, {
            hint: `Check the commit pinned in scripts/build/deps/ — it must be pushed to github.com/${repo}`,
          });
        }
        continue;
      }
      const checkedOut = git(["checkout", "-q", "--detach", "FETCH_HEAD"], "checkout");
      if (!checkedOut.ok) {
        lastError = checkedOut.stderr;
        continue;
      }
      done = true;
    }
    if (!done) {
      throw new BuildError(`Failed to fetch ${repo}@${commit} after ${retry.attempts} attempts:\n${lastError}`, {
        hint: "Check network connectivity to github.com",
      });
    }

    await rm(resolve(tree, ".git"), { recursive: true, force: true });
    const tmp = `${dest}.${process.pid}.partial`;
    await mkdir(resolve(dest, ".."), { recursive: true });
    const tarred = spawnSync(tarExe, ["-czf", tmp, "-C", work, top], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    if (tarred.error) throw new BuildError(`Failed to spawn tar`, { cause: tarred.error });
    if (tarred.status !== 0) throw new BuildError(`tar failed (exit ${tarred.status}): ${tarred.stderr}`);
    await rename(tmp, dest);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
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
 * A missing prebuilt tarball is a bad pin, not a network blip. The
 * `autobuild-preview-pr-*` WebKit tags are the sharp edge: GitHub deletes the
 * preview release when the PR merges or closes, so every build 404s at once.
 * Say so, and say which line to edit.
 */
function prebuiltDownloadError(name: string, url: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  // 404 only: a 403/429 is GitHub rate-limiting us, not a deleted release.
  const missing = message.includes("HTTP 404");
  if (name === "WebKit" && missing && url.includes("/autobuild-preview-pr-")) {
    return new BuildError(`WebKit preview release is gone: ${message}`, {
      cause,
      file: "scripts/build/deps/webkit.ts",
      hint:
        "WEBKIT_VERSION points at an `autobuild-preview-pr-*` tag. Those releases only exist " +
        "while the WebKit PR is open — this one has merged, closed, or been re-tagged. Set " +
        "WEBKIT_VERSION in scripts/build/deps/webkit.ts to the merged main sha (see " +
        "https://github.com/oven-sh/WebKit/releases).",
    });
  }
  if (missing) {
    return new BuildError(`Prebuilt ${name} is not published at that URL: ${message}`, {
      cause,
      hint: `Check the version pin for '${name}' in scripts/build/deps/.`,
    });
  }
  return cause instanceof Error ? cause : new BuildError(message);
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
  const started = performance.now();

  // Process-unique temp paths so concurrent builds (shared cacheDir across
  // checkouts) can't stomp each other's download/extraction.
  const suffix = `.${process.pid}.${Date.now().toString(36)}`;

  // ─── Download ───
  const destParent = resolve(dest, "..");
  await mkdir(destParent, { recursive: true });
  const tarballPath = `${dest}${suffix}.tar.gz`;
  try {
    await downloadWithRetry(url, tarballPath, name);
  } catch (err) {
    throw prebuiltDownloadError(name, url, err);
  }

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

    console.log(`extracted to ${dest} (${formatElapsed(performance.now() - started)})`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(tarballPath, { force: true });
  }
}
