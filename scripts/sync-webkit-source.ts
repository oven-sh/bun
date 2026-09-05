import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * What a WEBKIT_VERSION names. Both oven-sh/WebKit release workflows name the
 * release after the commit they built (build.yml: `autobuild-<sha>`,
 * build-preview.yml: `autobuild-preview-pr-<n>-<first 8 hex of the PR head>`)
 * and write that commit's full sha into every tarball as BUN_WEBKIT_VERSION.
 * The tag object behind the release is not consulted: until oven-sh/WebKit#461
 * it was created at whatever main's HEAD was when the release job ran, which is
 * never the PR head for a preview and is the next commit on main for about one
 * main release in six.
 */
export type PinnedCommit =
  | { sha: string }
  /** A preview names only 8 hex; the full sha is read from the downloaded prebuilt, whose cache directory starts with `webkit-<prebuiltKey>`. */
  | { shaPrefix: string; prebuiltKey: string };

export function pinnedCommit(version: string): PinnedCommit | undefined {
  const preview = /^autobuild-(preview-pr-\d+-([0-9a-f]{8}))$/.exec(version);
  if (preview) return { shaPrefix: preview[2], prebuiltKey: preview[1] };
  const sha = /^(?:autobuild-)?([0-9a-f]{40})$/.exec(version);
  if (sha) return { sha: sha[1] };
  return undefined;
}

/**
 * The commit that the prebuilt extracted under `<cacheDir>/webkit-<key>...` was built from. The
 * directory name is prebuiltDestDir() in build/deps/webkit.ts; every variant (debug, asan, lto,
 * other platforms) of one version carries the same sha, so the first one found will do.
 */
export function commitOfDownloadedPrebuilt(cacheDir: string, key: string): string | undefined {
  if (!existsSync(cacheDir)) return undefined;
  for (const header of new Bun.Glob(`webkit-${key}*/include/cmakeconfig.h`).scanSync({ cwd: cacheDir })) {
    const sha = /^#define BUN_WEBKIT_VERSION "([0-9a-f]{40})"/m.exec(readFileSync(join(cacheDir, header), "utf8"))?.[1];
    if (sha) return sha;
  }
  return undefined;
}

function shaBuiltFrom(version: string, cacheDir: string): string {
  const pin = pinnedCommit(version);
  if (!pin) {
    throw new Error(
      `cannot tell which commit WEBKIT_VERSION ${JSON.stringify(version)} was built from: expected a 40-hex sha, ` +
        "autobuild-<sha>, or autobuild-preview-pr-<n>-<first 8 hex of the sha>",
    );
  }
  if ("sha" in pin) return pin.sha;
  const sha = commitOfDownloadedPrebuilt(cacheDir, pin.prebuiltKey);
  if (!sha) {
    throw new Error(
      `${version} names only the first 8 hex of its commit; the full sha is read from the downloaded prebuilt, ` +
        `and there is none under ${cacheDir}\nbuild bun once with this pin (any profile downloads it), or pin the full sha`,
    );
  }
  if (!sha.startsWith(pin.shaPrefix)) {
    throw new Error(
      `the prebuilt under ${cacheDir} for ${version} was built from ${sha}, which is not the commit in the name`,
    );
  }
  return sha;
}

/** Runs git in the repo and returns what it printed; if git fails, the error carries git's own explanation. */
async function git(webkitRepo: string, args: string[]): Promise<string> {
  const out = await Bun.$`git ${args}`.cwd(webkitRepo).quiet().nothrow();
  if (out.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${webkitRepo}:\n${out.stderr.toString().trim()}`);
  return out.text().trim();
}

/** The commit `rev` names in the repo, or "" if it names nothing there (also for HEAD of a repo with no checkout yet). */
async function resolveCommit(webkitRepo: string, rev: string): Promise<string> {
  const out = await Bun.$`git rev-parse --verify ${rev}^{commit}`.cwd(webkitRepo).quiet().nothrow();
  return out.exitCode === 0 ? out.text().trim() : "";
}

/**
 * Fetches one commit by id, best effort (whether it arrived is checked afterwards). By id rather
 * than `git fetch origin`, whose refspec in a --single-branch or --depth clone covers only main's
 * tip; GitHub serves any commit it still has this way, a preview's included, even one the PR has
 * since force-pushed away. A shallow clone is kept shallow: fetching into one without --depth
 * downloads everything below the commit that the clone does not have, which for a commit older
 * than its boundary is all of WebKit's history. (--depth=1 would also re-shallow a clone at a
 * commit it already has, which is why the caller only gets here for a commit it does not.)
 * Returns git's explanation when the fetch fails, which is the same exit code whether origin does
 * not have the commit or could not be reached at all, and "" when it succeeded.
 */
async function fetchFromOrigin(webkitRepo: string, sha: string): Promise<string> {
  const shallow = (await git(webkitRepo, ["rev-parse", "--is-shallow-repository"])) === "true";
  const depth = shallow ? ["--depth=1"] : [];
  const out = await Bun.$`git fetch ${depth} origin ${sha}`.cwd(webkitRepo).quiet().nothrow();
  return out.exitCode === 0 ? "" : out.stderr.toString().trim();
}

/**
 * Checks `webkitRepo` out at the commit `version` was built from, fetching it first if the repo
 * does not have it. `cacheDir` is the build cache holding the downloaded prebuilts; only a preview
 * pin consults it.
 */
export async function syncWebKitSource(webkitRepo: string, version: string, cacheDir: string): Promise<string> {
  const sha = shaBuiltFrom(version, cacheDir);
  let expectedSha = await resolveCommit(webkitRepo, sha);
  let fetchFailure = "";
  if (!expectedSha) {
    fetchFailure = await fetchFromOrigin(webkitRepo, sha);
    expectedSha = await resolveCommit(webkitRepo, sha);
  }
  if (!expectedSha) {
    throw new Error(
      `commit ${sha} (${version}) is not in ${webkitRepo}, and fetching it from origin ` +
        (fetchFailure ? `failed:\n${fetchFailure}` : "did not bring it in"),
    );
  }

  const checkedOutCommit = await resolveCommit(webkitRepo, "HEAD");
  if (checkedOutCommit === expectedSha) {
    console.log(`already at ${version} (${expectedSha})`);
  } else {
    console.log(`changing from ${checkedOutCommit || "nothing checked out"} to ${version} (${expectedSha})`);
    // it is OK that this leaves you with a detached HEAD; this streams so that a big checkout shows progress
    await Bun.$`git checkout ${expectedSha}`.cwd(webkitRepo);
  }
  return expectedSha;
}

if (import.meta.main) {
  const bunRepo = dirname(import.meta.dir);
  const webkitRepo = join(bunRepo, "vendor/WebKit");
  if (!existsSync(webkitRepo)) {
    console.log("could not find WebKit clone");
    console.log("clone https://github.com/oven-sh/WebKit.git to vendor/WebKit");
    console.log("or create a symlink/worktree to an existing clone");
    process.exit(1);
  }

  // config.ts and deps/webkit.ts import each other; evaluating config.ts first
  // matches the build's entry order so WEBKIT_VERSION initializes before use.
  await import("./build/config.ts");
  const { WEBKIT_VERSION } = await import("./build/deps/webkit.ts");
  // Where resolveConfig() in build/config.ts puts a local build's cache (a --cache-dir override is not seen here).
  const bunInstall = process.env.BUN_INSTALL ? resolve(bunRepo, process.env.BUN_INSTALL) : join(homedir(), ".bun");
  try {
    await syncWebKitSource(webkitRepo, WEBKIT_VERSION, join(bunInstall, "build-cache"));
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
