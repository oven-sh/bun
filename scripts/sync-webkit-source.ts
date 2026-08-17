import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PinnedCommit {
  /** The commit the prebuilt was built from: a full sha, or the 8-hex prefix a preview tag carries. */
  rev: string;
  /** Refspecs to fetch from origin when the clone does not have `rev`; empty means origin's configured branches. */
  fetch: string[];
}

/**
 * WEBKIT_VERSION is a 40-hex sha or the name of an oven-sh/WebKit release.
 * Both release workflows name the release after the commit they built
 * (build.yml: `autobuild-<sha>`, build-preview.yml:
 * `autobuild-preview-pr-<n>-<first 8 hex of the PR head>`), so the name says
 * what the tarballs contain. The tag object behind the release does not:
 * releases created before oven-sh/WebKit#461 tagged whatever main's HEAD was
 * when the release job ran, which is never the PR head for a preview and is
 * the next commit on main for about one main release in six. The tag object is
 * therefore never consulted; the sha is taken from the name.
 */
export function pinnedCommit(version: string): PinnedCommit | undefined {
  const preview = /^autobuild-preview-pr-(\d+)-([0-9a-f]{8})$/.exec(version);
  if (preview) {
    // refs/pull/<n>/head still serves the commit once the PR's branch has been merged or deleted.
    return { rev: preview[2], fetch: [`refs/pull/${preview[1]}/head`] };
  }
  const sha = /^(?:autobuild-)?([0-9a-f]{40})$/.exec(version);
  if (sha) return { rev: sha[1], fetch: [] };
  return undefined;
}

async function resolveCommit(webkitRepo: string, rev: string): Promise<string> {
  const out = await Bun.$`git rev-parse --verify ${rev}^{commit}`.cwd(webkitRepo).quiet().nothrow();
  return out.exitCode === 0 ? out.text().trim() : "";
}

/** Checks `webkitRepo` out at the commit `version` was built from, fetching it first if needed. */
export async function syncWebKitSource(webkitRepo: string, version: string): Promise<string> {
  const pin = pinnedCommit(version);
  if (!pin) {
    throw new Error(
      `cannot tell which commit WEBKIT_VERSION ${JSON.stringify(version)} was built from: expected a 40-hex sha, ` +
        "autobuild-<sha>, or autobuild-preview-pr-<n>-<first 8 hex of the sha>",
    );
  }

  let expectedSha = await resolveCommit(webkitRepo, pin.rev);
  if (!expectedSha) {
    await Bun.$`git fetch origin ${pin.fetch}`.cwd(webkitRepo);
    expectedSha = await resolveCommit(webkitRepo, pin.rev);
  }
  if (!expectedSha) {
    const from = pin.fetch.length > 0 ? pin.fetch.join(", ") : "origin";
    throw new Error(
      `could not find commit ${pin.rev} (${version}) in ${webkitRepo} even after fetching ${from}\n` +
        "check that the commit exists on https://github.com/oven-sh/WebKit",
    );
  }

  const checkedOutCommit = (await Bun.$`git rev-parse HEAD`.cwd(webkitRepo).quiet().text()).trim();
  if (checkedOutCommit === expectedSha) {
    console.log(`already at ${version} (${expectedSha})`);
  } else {
    console.log(`changing from ${checkedOutCommit} to ${version} (${expectedSha})`);
    // it is OK that this leaves you with a detached HEAD
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
  try {
    await syncWebKitSource(webkitRepo, WEBKIT_VERSION);
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
