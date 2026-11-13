import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBranch, getCommit, getReleaseVersion } from "./buildkite.ts";

export const repository = "oven-sh/bun";
/** Where `bun upgrade` looks for the latest release. */
export const updaterRepository = "oven-sh/bun-releases-for-updater";

function git(...args: string[]): string {
  const { error, status, stdout, stderr } = spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });
  if (error || status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${error?.message ?? stderr.trim()}`);
  }
  return stdout;
}

function listRefs(repo: string, pattern: string): Map<string, string> {
  const lines = git("ls-remote", "--refs", `https://github.com/${repo}`, pattern).split("\n").filter(Boolean);
  return new Map(lines.map(line => line.split("\t").reverse() as [ref: string, commit: string]));
}

function compareVersions(a: string, b: string): number {
  const [left, right] = [a.split("."), b.split(".")];
  return left.map((part, i) => Number(part) - Number(right[i])).find(Boolean) ?? 0;
}

function getLatestVersion(repo: string): string {
  const latest = [...listRefs(repo, "refs/tags/bun-v*").keys()]
    .flatMap(ref => /^refs\/tags\/bun-v(\d+\.\d+\.\d+)$/.exec(ref)?.[1] ?? [])
    .sort(compareVersions)
    .at(-1);
  if (!latest) {
    throw new Error(`${repo} has no bun-v* tags`);
  }
  return latest;
}

/** Throws unless all of `commit` comes from main, and it has all that the previous release has. */
function checkHistory(commit: string, previousTag: string): void {
  // The checkout of a job can be shallow.
  const clone = mkdtempSync(join(tmpdir(), "release-history-"));
  try {
    const url = `https://github.com/${repository}`;
    git("clone", "--quiet", "--bare", "--filter=tree:0", "--no-tags", "--single-branch", "--branch=main", url, clone);
    git("--git-dir", clone, "fetch", "--quiet", "--no-tags", "origin", commit, "tag", previousTag);

    const listHashes = (ref: string) => git("--git-dir", clone, "rev-list", ref).split("\n").filter(Boolean);
    const main = new Set(listHashes("main"));
    /** `sources` are the commits of main that each one is, or says it was picked from. */
    const listCommits = (range: string) =>
      git("--git-dir", clone, "log", "-z", "--reverse", "--format=%H %s%n%b", range)
        .split("\0")
        .filter(Boolean)
        .map(message => {
          const hash = message.slice(0, 40);
          const picked = message.matchAll(/^\(cherry picked from commit ([0-9a-f]{40})\)$/gm);
          const sources = main.has(hash) ? [hash] : [...picked].map(([, from]) => from!).filter(from => main.has(from));
          return { title: message.slice(0, message.indexOf("\n")), sources };
        });
    const format = (commits: { title: string }[]) => commits.map(({ title }) => `\n  ${title}`).join("");

    const added = listCommits(`main..${commit}`);
    const strays = added.filter(({ sources }) => !sources.length);
    if (strays.length) {
      throw new Error(`These commits are neither on main nor a \`git cherry-pick -x\` from it:${format(strays)}`);
    }

    const included = new Set([...listHashes(commit), ...added.flatMap(({ sources }) => sources)]);
    const missing = listCommits(`${commit}..${previousTag}`).filter(
      ({ sources }) => !sources.length || !sources.every(source => included.has(source)),
    );
    if (missing.length) {
      throw new Error(`These commits of ${previousTag} are missing from this release:${format(missing)}`);
    }
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/** Throws unless the commit being built can become the release its branch names. */
export function checkRelease(): { version: string; commit: string; previousTag: string } {
  const branch = getBranch();
  const version = getReleaseVersion();
  if (!version) {
    throw new Error(`"${branch}" is not a release branch (release/bun-vX.Y.Z)`);
  }

  const { version: packageVersion } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  if (packageVersion !== version) {
    throw new Error(`package.json has version ${packageVersion}, but ${branch} releases ${version}`);
  }

  const latest = getLatestVersion(repository);
  for (const [repo, published] of [
    [repository, latest],
    [updaterRepository, getLatestVersion(updaterRepository)],
  ] as const) {
    if (compareVersions(version, published) <= 0) {
      throw new Error(`${version} is not newer than ${published}, which ${repo} has already published`);
    }
  }

  // BUILDKITE_COMMIT can still be "HEAD" in the first job of a build.
  const commit = getCommit(process.cwd());
  const head = listRefs(repository, `refs/heads/${branch}`).get(`refs/heads/${branch}`);
  if (!head) {
    throw new Error(`${repository} has no branch named ${branch}`);
  }
  if (head !== commit) {
    throw new Error(`This build is of ${commit}, but ${branch} is at ${head}. Start a new build of the branch.`);
  }

  const previousTag = `bun-v${latest}`;
  checkHistory(head, previousTag);

  return { version, commit: head, previousTag };
}
