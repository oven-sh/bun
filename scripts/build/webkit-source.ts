/**
 * The WebKit tree of `webkit: "source"`: the pinned commit of oven-sh/WebKit, fetched into the build cache.
 *
 * Configure fetches it, beside the macOS SDK and the Windows sysroot, because an edge can't: deps/webkit.ts reads which
 * files to compile out of the tree (its CMake lists and Sources.txt), so the tree decides the graph.
 *
 * It is a shallow, blobless, sparse git fetch of the few directories the build reads. GitHub refuses to serve an
 * `/archive/` tarball of WebKit (HTTP 422), and a clone is 12 GB.
 *
 * The directory is named by the commit and never edited, so it is shared by every checkout and profile that pins the
 * same WebKit. It is not `vendor/WebKit`, which is where people keep a clone of their own (`webkit: "local"`).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { downloadRetry, tryPrefetchExtracted, type RetryPolicy } from "./download.ts";
import { BuildError } from "./error.ts";

const REPO = "oven-sh/WebKit";

/** git sparse-checkout patterns (non-cone: gitignore syntax, anchored at the root of the repository). */
const sparse = [
  "/Source/bmalloc/",
  "/Source/WTF/",
  "/Source/JavaScriptCore/",
  // Which ICU, its patches, and what of its data stays uncompressed (deps/icu.ts).
  "/icu/",
  // The `mig` driver for a host that is not a Mac, and the headers Apple's migcom compiles against there.
  "/macos-cross/",
];

const STAMP = ".ref";

/** A release tag names its commit (`autobuild-<sha>`, `autobuild-preview-pr-<n>-<sha>`); git fetches either. */
function stampContents(version: string): string {
  return `${version} ${createHash("sha256").update(sparse.join("\n")).digest("hex").slice(0, 16)}`;
}

export function webkitSourceDir(cacheDir: string, version: string): string {
  const name = version.startsWith("autobuild-") ? version.slice("autobuild-".length) : version.slice(0, 16);
  return resolve(cacheDir, `webkit-source-${name}`);
}

export function hasWebKitSource(dir: string, version: string): boolean {
  const stamp = resolve(dir, STAMP);
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === stampContents(version);
}

export async function ensureWebKitSource(
  cfg: { webkit: string; webkitVersion: string; localDeps: Record<string, string> },
  retry: RetryPolicy = downloadRetry,
): Promise<void> {
  if (cfg.webkit !== "source") return;
  const dir = cfg.localDeps.WebKit!;
  const version = cfg.webkitVersion;
  if (hasWebKitSource(dir, version)) return;
  if (await tryPrefetchExtracted(dir, STAMP, stampContents(version))) return;

  const started = Date.now();
  console.log(`[webkit] fetching ${REPO} ${version}`);
  const staging = `${dir}.${process.pid}.${Date.now().toString(36)}.staging`;
  await mkdir(staging, { recursive: true });

  // http.lowSpeed*: a transfer under 1 KB/s for 60 s is a dead connection. git gives it up and the loop below retries.
  // Not spawnSync: configure goes on with its other downloads meanwhile.
  const git = (args: string[], input?: string): Promise<{ ok: boolean; stderr: string }> =>
    new Promise((done, fail) => {
      const child = spawn(
        "git",
        [
          ...["-c", "protocol.version=2", "-c", "advice.detachedHead=false"],
          ...["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"],
          ...args,
        ],
        {
          cwd: staging,
          stdio: [input === undefined ? "ignore" : "pipe", "ignore", "pipe"],
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      );
      let stderr = "";
      child.stderr!.setEncoding("utf8").on("data", chunk => (stderr += chunk));
      child.stdin?.end(input);
      child.on("error", cause =>
        fail(new BuildError(`Failed to run git ${args[0]}`, { hint: "Is `git` in your PATH?", cause })),
      );
      child.on("close", code => done({ ok: code === 0, stderr }));
    });
  const mustGit = async (args: string[], input?: string): Promise<void> => {
    const { ok, stderr } = await git(args, input);
    if (!ok) throw new BuildError(`git ${args[0]} failed in ${staging}:\n${stderr}`);
  };

  try {
    await mustGit(["init", "-q"]);
    // A Windows host has to write the bytes a POSIX one does, and WebKit's paths are long.
    await mustGit(["config", "core.autocrlf", "false"]);
    await mustGit(["config", "core.longpaths", "true"]);
    await mustGit(["remote", "add", "origin", `https://github.com/${REPO}.git`]);
    await mustGit(["sparse-checkout", "set", "--no-cone", "--stdin"], sparse.join("\n") + "\n");

    // fetch brings the commit and its trees; checkout then asks for the blobs the sparse set selects.
    let lastError = "";
    let done = false;
    for (let attempt = 1; attempt <= retry.attempts && !done; attempt++) {
      if (attempt > 1) {
        const backoffMs = retry.backoffMs(attempt);
        console.log(
          `[webkit] retry ${attempt}/${retry.attempts} in ${backoffMs}ms (${lastError.trim().split("\n").pop()})`,
        );
        await new Promise(r => setTimeout(r, backoffMs));
      }
      const fetched = await git(["fetch", "-q", "--depth=1", "--filter=blob:none", "--no-tags", "origin", version]);
      if (!fetched.ok) {
        lastError = fetched.stderr;
        if (/couldn't find remote ref|not our ref|no such remote ref/i.test(lastError)) {
          throw new BuildError(`${REPO} has no commit ${version}\n${lastError}`, {
            hint:
              "WEBKIT_VERSION (scripts/build/deps/webkit.ts) or --webkit-version has to be pushed to github.com/" +
              REPO,
          });
        }
        continue;
      }
      const checkedOut = await git(["checkout", "-q", "--detach", "FETCH_HEAD"]);
      if (!checkedOut.ok) {
        lastError = checkedOut.stderr;
        continue;
      }
      done = true;
    }
    if (!done) {
      throw new BuildError(`Failed to fetch ${REPO} ${version} after ${retry.attempts} attempts:\n${lastError}`, {
        hint: "Check network connectivity to github.com",
      });
    }

    await rm(resolve(staging, ".git"), { recursive: true, force: true });
    await writeFile(resolve(staging, STAMP), stampContents(version) + "\n");
    await rm(dir, { recursive: true, force: true });
    try {
      await rename(staging, dir);
    } catch (err) {
      // Another build of the same WebKit got there first.
      if (!hasWebKitSource(dir, version)) throw err;
    }
    console.log(`[webkit] extracted to ${dir} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
