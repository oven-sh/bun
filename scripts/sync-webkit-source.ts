import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PinnedCommit =
  /** A 40-hex sha, with or without the `autobuild-` prefix of the release built from it. */
  | { sha: string }
  /** `autobuild-preview-pr-<n>-<sha8>`: the first 8 hex of the PR head the preview was built from. */
  | { shaPrefix: string; pullRef: string };

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
    return { shaPrefix: preview[2], pullRef: `refs/pull/${preview[1]}/head` };
  }
  const sha = /^(?:autobuild-)?([0-9a-f]{40})$/.exec(version);
  if (sha) return { sha: sha[1] };
  return undefined;
}

async function resolveCommit(webkitRepo: string, rev: string): Promise<string> {
  const out = await Bun.$`git rev-parse --verify ${rev}^{commit}`.cwd(webkitRepo).quiet().nothrow();
  return out.exitCode === 0 ? out.text().trim() : "";
}

/** The commit objects in the repo whose sha starts with `prefix`. */
async function commitsWithPrefix(webkitRepo: string, prefix: string): Promise<string[]> {
  const ids = (await Bun.$`git rev-parse --disambiguate=${prefix}`.cwd(webkitRepo).quiet().text()).split("\n");
  const commits: string[] = [];
  for (const id of ids.filter(Boolean)) {
    const type = (await Bun.$`git cat-file -t ${id}`.cwd(webkitRepo).quiet().text()).trim();
    if (type === "commit") commits.push(id);
  }
  return commits;
}

async function commitBuiltFrom(webkitRepo: string, version: string, pin: PinnedCommit): Promise<string> {
  if ("sha" in pin) {
    let sha = await resolveCommit(webkitRepo, pin.sha);
    if (!sha) {
      await Bun.$`git fetch origin`.cwd(webkitRepo);
      sha = await resolveCommit(webkitRepo, pin.sha);
    }
    if (sha) return sha;
    throw new Error(
      `could not find commit ${pin.sha} (${version}) in ${webkitRepo} even after fetching origin\n` +
        "check that the commit exists on https://github.com/oven-sh/WebKit",
    );
  }

  // The prefix is only ever compared against whole object ids, never resolved as a name:
  // `git rev-parse <prefix>` would accept a ref called that, or an unrelated commit sharing the
  // prefix, while the PR head itself has not been fetched yet. Fetching first puts the built
  // commit among the candidates whenever the PR still has it.
  await Bun.$`git fetch origin ${pin.pullRef}`.cwd(webkitRepo);
  const commits = await commitsWithPrefix(webkitRepo, pin.shaPrefix);
  if (commits.length === 1) return commits[0];
  if (commits.length === 0) {
    const head = await resolveCommit(webkitRepo, "FETCH_HEAD");
    throw new Error(
      `no commit starting with ${pin.shaPrefix} (${version}) in ${webkitRepo} even after fetching ${pin.pullRef}, ` +
        `whose head is ${head}\nthe preview was built from a push the PR no longer has`,
    );
  }
  throw new Error(`${pin.shaPrefix} (${version}) matches more than one commit in ${webkitRepo}: ${commits.join(", ")}`);
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
  const expectedSha = await commitBuiltFrom(webkitRepo, version, pin);

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
