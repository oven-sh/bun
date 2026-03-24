#!/usr/bin/env bun
/**
 * Fetch CLI — the single entry point ninja invokes for all downloads.
 *
 * Ninja rules reference this file via `cfg.bun <this-file> <kind> <args...>`.
 * This is BUILD-time code (runs under ninja), not CONFIGURE-time. The
 * configure-time modules (source.ts, zig.ts) emit ninja rules that call
 * into here but don't execute any of it themselves.
 *
 * ## Adding a new fetch kind
 *
 * 1. Write the implementation below (or in download.ts if shared).
 * 2. Add a `case` in main() that parses argv and calls it.
 * 3. Reference `fetchCliPath` in the ninja rule command.
 *
 * ## Args format
 *
 *   argv: [bun, fetch-cli.ts, <kind>, ...kind-specific-positional-args]
 *
 * Positional, not flags — these commands are only invoked by ninja with
 * args we control, never by humans. Named flags would be YAGNI.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { downloadWithRetry, extractTarGz, fetchPrebuilt } from "./download.ts";
import { BuildError, assert } from "./error.ts";
import { fetchZig } from "./zig.ts";

/**
 * Absolute path to this file. Ninja rules use this in their command strings.
 *
 * This is a stable way for library modules to build the ninja command
 * without knowing where fetch-cli.ts lives — import this constant and
 * use it in `command: "${cfg.bun} ${fetchCliPath} <kind> ..."`.
 */
export const fetchCliPath: string = import.meta.filename;

// ───────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , kind, ...args] = process.argv;

  switch (kind) {
    case "dep": {
      // fetch-cli.ts dep <name> <repo> <commit> <dest> <cache> [...patches]
      const [name, repo, commit, dest, cache, ...patches] = args;
      assert(name !== undefined && repo !== undefined && commit !== undefined, "dep: missing name/repo/commit");
      assert(dest !== undefined && cache !== undefined, "dep: missing dest/cache");
      return fetchDep(name, repo, commit, dest, cache, patches);
    }

    case "prebuilt": {
      // fetch-cli.ts prebuilt <name> <url> <dest> <identity> [...rm_paths]
      const [name, url, dest, identity, ...rmPaths] = args;
      assert(
        name !== undefined && url !== undefined && dest !== undefined && identity !== undefined,
        "prebuilt: missing name/url/dest/identity",
      );
      return fetchPrebuilt(name, url, dest, identity, rmPaths);
    }

    case "zig": {
      // fetch-cli.ts zig <url> <dest> <commit>
      const [url, dest, commit] = args;
      assert(url !== undefined && dest !== undefined && commit !== undefined, "zig: missing url/dest/commit");
      return fetchZig(url, dest, commit);
    }

    case undefined:
    case "--help":
    case "-h":
      process.stderr.write(USAGE);
      process.exit(1);
      break;

    default:
      throw new BuildError(`Unknown fetch kind: ${kind}`, { hint: USAGE });
  }
}

const USAGE = `\
Usage: bun fetch-cli.ts <kind> <args...>

Kinds:
  dep      <name> <repo> <commit> <dest> <cache> [...patches]
  prebuilt <name> <url> <dest> <identity> [...rm_paths]
  zig      <url> <dest> <commit>

This is invoked by ninja build rules. You shouldn't need to call it
directly — run ninja targets instead.
`;

// ───────────────────────────────────────────────────────────────────────────
// github-archive dep fetch: download tarball, extract, patch, stamp
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fetch a github archive, extract, apply patches, write .ref stamp.
 *
 * Idempotent: if .ref exists and matches the computed identity, does nothing.
 * The ninja rule has restat=1, so a no-op fetch won't trigger downstream.
 *
 * Tarballs are cached in `cache/` keyed by URL sha256 — downloads are skipped
 * if the tarball already exists. Useful when re-extraction is needed after
 * a failed patch (you don't re-download).
 */
async function fetchDep(
  name: string,
  repo: string,
  commit: string,
  dest: string,
  cache: string,
  patches: string[],
): Promise<void> {
  const refPath = join(dest, ".ref");

  // Read patch contents (needed for identity + applying later).
  // If a listed patch doesn't exist, that's a bug in the dep definition.
  const patchContents: string[] = [];
  for (const patch of patches) {
    try {
      patchContents.push(await readFile(patch, "utf8"));
    } catch (cause) {
      throw new BuildError(`Patch file not found: ${patch}`, {
        hint: `Check the patches list in deps/${name}.ts`,
        cause,
      });
    }
  }

  const identity = computeSourceIdentity(commit, patchContents);

  // Short-circuit: already fetched at this identity?
  if (existsSync(refPath)) {
    const existing = readFileSync(refPath, "utf8").trim();
    if (existing === identity) {
      // No-op. Don't touch .ref — restat will see unchanged mtime.
      // Printed so the ninja [N/M] line has closure instead of silence.
      console.log(`up to date`);
      return;
    }
    // Identity mismatch. Blow it away.
    console.log(`source identity changed (was ${existing.slice(0, 8)}, now ${identity.slice(0, 8)})`);
  }

  console.log(`fetching ${repo}@${commit.slice(0, 8)}`);

  // ─── Download (with cache) ───
  const url = `https://github.com/${repo}/archive/${commit}.tar.gz`;
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const tarballPath = join(cache, `${name}-${urlHash}.tar.gz`);

  await mkdir(cache, { recursive: true });

  if (!existsSync(tarballPath)) {
    await downloadWithRetry(url, tarballPath, name);
  }

  // ─── Extract ───
  // Wipe dest first — we don't want leftover files from a previous version.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  // Github archives have a top-level directory <repo>-<commit>/. Strip it.
  await extractTarGz(tarballPath, dest);

  // ─── Apply patches / overlays ───
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    const name = basename(p);
    if (p.endsWith(".patch")) {
      console.log(`applying ${name}`);
      applyPatch(dest, p, patchContents[i]!);
    } else {
      // Overlay file: copy into source root. Used for e.g. injecting a
      // CMakeLists.txt into a project that doesn't have one (tinycc).
      console.log(`overlay ${name}`);
      await writeFile(join(dest, name), patchContents[i]!);
    }
  }

  // ─── Write stamp ───
  // Written LAST — if anything above failed, no stamp means next build retries.
  await writeFile(refPath, identity + "\n");
  console.log(`done → ${dest}`);
}

/**
 * Source identity: sha256(commit + patch_contents)[:16]. This is what goes
 * in the .ref stamp. Hashing patch CONTENTS (not paths) means editing a
 * patch invalidates the source without a commit bump.
 *
 * CRLF→LF normalized before hashing: git autocrlf may have converted
 * LF→CRLF on Windows checkout. Without normalization, the same patch
 * would produce different identities across platforms, triggering
 * spurious re-fetches (and worse: `git apply` rejects CRLF patches as
 * corrupt, so the re-fetch would fail). The normalized content is also
 * what applyPatch() pipes to git — one read, one normalization, used
 * for both hashing and applying.
 *
 * Exported so source.ts can compute the same identity at configure time
 * (for the preemptive-delete-on-mismatch check).
 */
export function computeSourceIdentity(commit: string, patchContents: string[]): string {
  const h = createHash("sha256");
  h.update(commit);
  for (const content of patchContents) {
    h.update("\0"); // Separator so patch concatenation can't produce collisions.
    h.update(normalizeLf(content));
  }
  return h.digest("hex").slice(0, 16);
}

/** CRLF→LF. Used for patch content before hashing and `git apply`. */
function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/**
 * Apply a patch via `git apply` over stdin.
 *
 * Normalizes CRLF→LF (same as the identity hash — see computeSourceIdentity)
 * so a CRLF-mangled checkout still applies cleanly. --no-index: dest/ is
 * not a git repo. --ignore-whitespace / --ignore-space-change: patches are
 * authored against upstream which may have different trailing whitespace.
 */
function applyPatch(dest: string, patchPath: string, patchBody: string): void {
  const result = spawnSync("git", ["apply", "--ignore-whitespace", "--ignore-space-change", "--no-index", "-"], {
    cwd: dest,
    input: normalizeLf(patchBody),
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });

  if (result.error) {
    throw new BuildError(`Failed to spawn git apply`, { cause: result.error });
  }

  if (result.status !== 0) {
    // If the patch was already applied, the source dir must have been
    // partially fetched, which means .ref shouldn't exist, which means
    // we should have rm'd the dir. A "cleanly" error here = logic bug.
    throw new BuildError(`Patch failed: ${result.stderr}`, {
      file: patchPath,
      hint: "The patch may be out of date with the pinned commit",
    });
  }
}

// Only run if this file is the entry point (not imported as a module).
// fetch-cli.ts is ALSO imported by source.ts/zig.ts to get fetchCliPath —
// that import should NOT execute main().
if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    // Format BuildError nicely; let anything else bubble to bun's default
    // uncaught handler (gets a stack trace, which is what you want for bugs).
    if (err instanceof BuildError) {
      process.stderr.write(err.format());
      process.exit(1);
    }
    throw err;
  }
}
