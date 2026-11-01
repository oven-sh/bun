/**
 * The WebKit tree of `webkit: "source"`: the pinned commit of oven-sh/WebKit, fetched into the build cache.
 *
 * Configure fetches it, beside the macOS SDK and the Windows sysroot: deps/webkit.ts reads which files to compile out of
 * the tree (its CMake lists and Sources.txt), so there is no graph to write without it. An edge that `build.ninja`
 * depends on (`contentsDecideGraph`) would gain nothing: ninja runs such an edge before every other.
 *
 * It is a shallow, blobless, sparse git fetch of the few directories the build reads. GitHub refuses to serve an
 * `/archive/` tarball of WebKit (HTTP 422), and a clone is 12 GB.
 *
 * The directory is named by the commit and never edited, so it is shared by every checkout and profile that pins the
 * same WebKit. It is not `vendor/WebKit`, which is where people keep a clone of their own (`webkit: "local"`).
 */

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { downloadRetry, fetchIntoCache } from "./download.ts";
import { BuildError, describeError } from "./error.ts";

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

/** A WebKit version in a directory's name: 16 characters of a sha, or all of a release tag, whose sha is at its end. */
export function webkitVersionKey(version: string): string {
  return version.startsWith("autobuild-") ? version.slice("autobuild-".length) : version.slice(0, 16);
}

export function webkitSourceDir(cacheDir: string, version: string): string {
  return resolve(cacheDir, `webkit-source-${webkitVersionKey(version)}`);
}

const git = (cwd: string, ...args: string[]) =>
  promisify(execFile)(
    "git",
    [
      ...["-c", "protocol.version=2", "-c", "advice.detachedHead=false"],
      // A Windows host has to write the bytes a POSIX one does, and WebKit's paths are long.
      ...["-c", "core.autocrlf=false", "-c", "core.longpaths=true"],
      // A transfer under 1 KB/s for 60 s is a dead connection: git gives it up, and the fetch is tried again.
      ...["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"],
      ...args,
    ],
    { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  );

/** `cfg.webkitVersion` is a commit or a release tag (`autobuild-<sha>`, `autobuild-preview-pr-<n>-<sha>`); git fetches either. */
export async function ensureWebKitSource(cfg: {
  webkit: string;
  webkitVersion: string;
  localDeps: Record<string, string>;
}): Promise<void> {
  if (cfg.webkit !== "source") return;
  const version = cfg.webkitVersion;
  const identity = `${version} ${sparse.join(" ")}`;
  await fetchIntoCache("WebKit", `${REPO} ${version}`, cfg.localDeps.WebKit!, identity, async (staging, say) => {
    await git(staging, "init", "-q");
    await git(staging, "remote", "add", "origin", `https://github.com/${REPO}.git`);
    await git(staging, "sparse-checkout", "set", "--no-cone", ...sparse);
    for (let attempt = 1; ; attempt++) {
      try {
        // fetch brings the commit and its trees; checkout then asks for the blobs the sparse set selects.
        await git(staging, "fetch", "-q", "--depth=1", "--filter=blob:none", "--no-tags", "origin", version);
        await git(staging, "checkout", "-q", "--detach", "FETCH_HEAD");
        break;
      } catch (err) {
        const why = (err as { stderr?: string }).stderr?.trim() || describeError(err);
        if (/couldn't find remote ref|not our ref|no such remote ref/i.test(why)) {
          throw new BuildError(`${REPO} has no commit ${version}\n${why}`, {
            hint: `WEBKIT_VERSION (scripts/build/deps/webkit.ts) or --webkit-version has to be pushed to github.com/${REPO}`,
          });
        }
        if (attempt === downloadRetry.attempts) {
          throw new BuildError(`Failed to fetch ${REPO} ${version} after ${attempt} attempts:\n${why}`, {
            hint: "Check network connectivity to github.com",
          });
        }
        const backoffMs = downloadRetry.backoffMs(attempt + 1);
        say(`retry ${attempt + 1}/${downloadRetry.attempts} in ${backoffMs}ms (${why.split("\n").pop()})`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
    await rm(resolve(staging, ".git"), { recursive: true, force: true });
  });
}
