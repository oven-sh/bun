#!/usr/bin/env node

// Fails unless the commit being built can become the release its branch names.
// Prints the tag of the release it follows.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getBranch, getCommit, getReleaseVersion } from "./buildkite.ts";

const repository = "https://github.com/oven-sh/bun";
/** Where `bun upgrade` looks for the latest release. */
const updaterRepository = "https://github.com/oven-sh/bun-releases-for-updater";

function listRefs(url: string, pattern: string): Map<string, string> {
  const { error, status, stdout, stderr } = spawnSync("git", ["ls-remote", "--refs", url, pattern], {
    encoding: "utf8",
  });
  if (error || status !== 0) {
    throw new Error(`Failed to list ${pattern} of ${url}: ${error?.message ?? stderr.trim()}`);
  }
  const lines = stdout.split("\n").filter(Boolean);
  return new Map(lines.map(line => line.split("\t").reverse() as [ref: string, commit: string]));
}

function compareVersions(a: string, b: string): number {
  const [left, right] = [a.split("."), b.split(".")];
  return left.map((part, i) => Number(part) - Number(right[i])).find(Boolean) ?? 0;
}

function getLatestVersion(url: string): string {
  const latest = [...listRefs(url, "refs/tags/bun-v*").keys()]
    .flatMap(ref => /^refs\/tags\/bun-v(\d+\.\d+\.\d+)$/.exec(ref)?.[1] ?? [])
    .sort(compareVersions)
    .at(-1);
  if (!latest) {
    throw new Error(`${url} has no bun-v* tags`);
  }
  return latest;
}

export function checkRelease(): { previousTag: string } {
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
  for (const [url, published] of [
    [repository, latest],
    [updaterRepository, getLatestVersion(updaterRepository)],
  ] as const) {
    if (compareVersions(version, published) <= 0) {
      throw new Error(`${version} is not newer than ${published}, which ${url} has already published`);
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

  return { previousTag: `bun-v${latest}` };
}

if (import.meta.main) {
  console.log(checkRelease().previousTag);
}
