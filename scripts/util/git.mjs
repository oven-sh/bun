#!/usr/bin/env node

import { exists, mkdir } from "./fs.mjs";
import { spawn, spawnSync } from "./spawn.mjs";
import { isBuildKite, isGithubAction, isCI, getCpus, isMain, isWindows } from "./env.mjs";
import { print } from "./util.mjs";

/**
 * Gets the commit SHA.
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getSha(cwd) {
  if (cwd || !isCI) {
    const { exitCode, stdout } = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      throwOnError: false,
    });
    if (exitCode === 0) {
      return stdout.trim();
    }
  }

  if (isBuildKite) {
    return process.env["BUILDKITE_COMMIT"];
  }

  if (isGithubAction) {
    return process.env["GITHUB_SHA"];
  }
}

/**
 * Gets the git branch.
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getBranch(cwd) {
  if (cwd || !isCI) {
    const { exitCode, stdout } = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      throwOnError: false,
    });
    if (exitCode === 0) {
      return stdout.trim();
    }
  }

  if (isBuildKite) {
    const name = process.env["BUILDKITE_BRANCH"];
    const fork = process.env["BUILDKITE_PULL_REQUEST_REPO"];

    // If the following setting is enabled, branch names are prefixed with the fork name:
    // "Prefix third-party fork branch names"
    if (fork && name.startsWith(`${fork}:`)) {
      return name.slice(fork.length + 1);
    }

    return name;
  }

  if (isGithubAction) {
    return process.env["GITHUB_REF_NAME"];
  }
}

/**
 * Gets the git repository URL.
 * @param {string} [cwd]
 * @returns {string | undefined}
 * @example "https://github.com/oven-sh/bun"
 */
export function getRepositoryUrl(cwd) {
  /**
   * @param {string} [url]
   * @returns {string | undefined}
   */
  function parse(url) {
    if (!url) {
      return;
    }
    if (url.startsWith("git@")) {
      const i = url.lastIndexOf(":");
      url = `https://${url.slice(4, i)}/${url.slice(i + 1)}`;
    }
    if (url.startsWith("git:")) {
      url = url.replace(/^git:/, "https://");
    }
    if (url.endsWith(".git")) {
      url = url.slice(0, -4);
    }
    const { href } = new URL(url);
    return href;
  }

  if (cwd || !isCI) {
    const { exitCode, stdout } = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd,
      throwOnError: false,
    });
    if (exitCode === 0) {
      return parse(stdout.trim());
    }
  }

  if (isBuildKite) {
    return parse(process.env["BUILDKITE_PULL_REQUEST_REPO"] || process.env["BUILDKITE_REPO"]);
  }

  if (isGithubAction) {
    const baseUrl = process.env["GITHUB_SERVER_URL"];
    const repository = process.env["GITHUB_REPOSITORY"];
    if (baseUrl && repository) {
      return parse(`${baseUrl}/${repository}`);
    }
  }
}

/**
 * Gets the git repository.
 * @param {string} [cwd]
 * @returns {string | undefined}
 * @example "oven-sh/bun"
 */
export function getRepository(cwd) {
  const url = getRepositoryUrl(cwd);
  if (!url) {
    return;
  }
  const { pathname } = new URL(url);
  return pathname.slice(1);
}

/**
 * Tests if the repository is a fork.
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function isFork(cwd) {
  if (isBuildKite) {
    return process.env["BUILDKITE_PULL_REQUEST_REPO"] !== process.env["BUILDKITE_REPO"];
  }

  if (isGithubAction) {
    // TODO: Figure out how to detect this.
  }

  return false;
}

/**
 * If the current branch is a pull request, returns the pull request number.
 * @param {string} [cwd]
 * @returns {number | undefined}
 */
export function getPullRequest(cwd) {
  if (isBuildKite) {
    const pullRequest = process.env["BUILDKITE_PULL_REQUEST"];
    if (pullRequest) {
      return parseInt(pullRequest);
    }
  }

  if (isGithubAction) {
    const isPullRequest = !!process.env["GITHUB_BASE_REF"];
    if (isPullRequest) {
      const gitRef = process.env["GITHUB_REF"];
      const match = gitRef.match(/^refs\/pull\/(\d+)\/merge$/);
      if (match) {
        const [, pullRequest] = match;
        return parseInt(pullRequest);
      }
    }
  }
}

/**
 * Tests if the current branch is main, and the repository is not a fork.
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function isMainBranch(cwd) {
  return getBranch(cwd) === "main" && !isFork(cwd) && !getPullRequest(cwd);
}

/**
 * Gets a list of added or modified files from the main branch.
 * @param {string} [cwd]
 * @param {string} [ref]
 * @returns {string[] | undefined}
 */
export function getChangedFiles(cwd, ref) {
  const { exitCode, stdout } = spawnSync("git", ["diff", "--name-only", "--diff-filter=AM", ref || "main"], {
    cwd,
    throwOnError: false,
  });

  if (exitCode !== 0) {
    return;
  }

  return stdout.trim().split("\n");
}

/**
 * Gets a hash of the given path.
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getHash(cwd) {
  const shell = isWindows ? "pwsh" : "sh";
  const args = ["-c", "git ls-files -s . | git hash-object --stdin"];
  const { stdout } = spawnSync(shell, args, { cwd });

  return stdout.trim();
}

/**
 * @typedef {Object} GitCloneOptions
 * @property {string} [cwd]
 * @property {string} [commit]
 * @property {boolean} [recursive]
 */

/**
 * Clones a git repository.
 * @param {string} repository
 * @param {GitCloneOptions} options
 */
export async function clone(repository, options = {}) {
  const { cwd, recursive, commit } = options;
  const jobs = `${getCpus()}`;

  /**
   * @param {string} cwd
   * @returns {Promise<boolean>}
   */
  async function clone(cwd) {
    {
      const { exitCode, stdout } = await spawn("git", ["rev-parse", "HEAD"], { cwd, throwOnError: false });
      if (exitCode === 0 && stdout.trim() === commit) {
        return true;
      }
    }
    {
      const { exitCode } = await spawn("git", ["-c", "init.defaultBranch=main", "init"], {
        cwd,
        throwOnError: false,
      });
      if (exitCode !== 0) {
        return false;
      }
    }
    {
      const { exitCode, stderr } = await spawn("git", ["remote", "add", "origin", repository], {
        cwd,
        throwOnError: false,
      });
      if (exitCode !== 0 && !stderr.includes("remote origin already exists")) {
        return false;
      }
    }
    {
      const args = ["fetch", "--progress", "--depth", "1", "--jobs", jobs, "origin", commit || "main"];
      if (recursive) {
        args.push("--recurse-submodules");
      }
      const { exitCode } = await spawn("git", args, {
        cwd,
        throwOnError: false,
      });
      if (exitCode !== 0) {
        return false;
      }
    }
    {
      const { exitCode } = await spawn(
        "git",
        ["-c", "advice.detachedHead=false", "checkout", "--force", "FETCH_HEAD"],
        {
          cwd,
          throwOnError: false,
        },
      );
      if (exitCode !== 0) {
        return false;
      }
    }
    return true;
  }

  mkdir(cwd);

  let done;
  for (let i = 0; i < 3; i++) {
    done = await clone(cwd);
    if (done) {
      break;
    }
  }

  if (!done) {
    throw new Error(`Failed to clone repository: ${repository}`);
  }

  if (isCI) {
    await reset(cwd);
  }
}

/**
 * Cleans a git repository.
 * @param {string} cwd
 */
export async function clean(cwd) {
  if (!exists(cwd)) {
    return;
  }

  if (isCI) {
    await reset(cwd);
  }

  await spawn("git", ["clean", "-fdx"], { cwd });
}

/**
 * Resets the git repository.
 * @param {string} cwd
 */
export async function reset(cwd) {
  if (!exists(cwd)) {
    return;
  }

  await spawn("git", ["reset", "--hard"], { cwd });
}

if (isMain(import.meta.url)) {
  print(`
  {dim}>{reset} {bold}{yellow}${getRepositoryUrl()}{reset}
  {dim}|{reset} {cyan}Repository:{reset} ${getRepository() ?? "N/A"}
  {dim}|{reset} {cyan}Is Fork?:{reset} ${isFork()}
  {dim}|{reset} {cyan}Branch:{reset} ${getBranch() ?? "N/A"}
  {dim}|{reset} {cyan}Is Main Branch?:{reset} ${isMainBranch()}
  {dim}|{reset} {cyan}Commit:{reset} ${getSha() ?? "N/A"}
  {dim}|{reset} {cyan}Pull Request:{reset} ${getPullRequest() ?? "N/A"}
  {dim}|{reset} {cyan}Changed Files:{reset} ${getChangedFiles()?.length ?? "N/A"}
  {dim}|{reset} {cyan}Hash:{reset} ${getHash()}
  `);
}
