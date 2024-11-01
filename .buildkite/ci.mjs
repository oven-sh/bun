#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

function getEnv(name, required = true) {
  const value = process.env[name];

  if (!value && required) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getRepository() {
  const url = getEnv("BUILDKITE_PULL_REQUEST_REPO", false) || getEnv("BUILDKITE_REPO");
  const match = url.match(/github.com\/([^/]+)\/([^/]+)\.git$/);
  if (!match) {
    throw new Error(`Unsupported repository: ${url}`);
  }
  const [, owner, repo] = match;
  return `${owner}/${repo}`;
}

function getCommit() {
  return getEnv("BUILDKITE_COMMIT");
}

function getCommitMessage() {
  return getEnv("BUILDKITE_MESSAGE", false) || "";
}

function getBranch() {
  return getEnv("BUILDKITE_BRANCH");
}

function getMainBranch() {
  return getEnv("BUILDKITE_PIPELINE_DEFAULT_BRANCH", false) || "main";
}

function isFork() {
  const repository = getEnv("BUILDKITE_PULL_REQUEST_REPO", false);
  return !!repository && repository !== getEnv("BUILDKITE_REPO");
}

function isMainBranch() {
  return getBranch() === getMainBranch() && !isFork();
}

function isMergeQueue() {
  return /^gh-readonly-queue/.test(getEnv("BUILDKITE_BRANCH"));
}

function isPullRequest() {
  return getEnv("BUILDKITE_PULL_REQUEST", false) === "true";
}

async function getChangedFiles() {
  const repository = getRepository();
  const head = getCommit();
  const base = `${head}^1`;

  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/compare/${base}...${head}`);
    if (response.ok) {
      const { files } = await response.json();
      return files.filter(({ status }) => !/removed|unchanged/i.test(status)).map(({ filename }) => filename);
    }
  } catch (error) {
    console.error(error);
  }
}

function getBuildUrl() {
  return getEnv("BUILDKITE_BUILD_URL");
}

async function getBuildIdWithArtifacts() {
  let depth = 0;
  let url = getBuildUrl();

  while (url) {
    const response = await fetch(`${url}.json`, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return;
    }

    const { id, state, prev_branch_build: lastBuild, steps } = await response.json();
    if (depth++) {
      if (state === "failed" || state === "passed") {
        const buildSteps = steps.filter(({ label }) => label.endsWith("build-bun"));
        if (buildSteps.length) {
          if (buildSteps.every(({ outcome }) => outcome === "passed")) {
            return id;
          }
          return;
        }
      }
    }

    if (!lastBuild) {
      return;
    }

    url = url.replace(/\/builds\/[0-9]+/, `/builds/${lastBuild["number"]}`);
  }
}

function toYaml(obj, indent = 0) {
  const spaces = " ".repeat(indent);
  let result = "";

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }

    if (value === null) {
      result += `${spaces}${key}: null\n`;
      continue;
    }

    if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      value.forEach(item => {
        if (typeof item === "object" && item !== null) {
          result += `${spaces}- \n${toYaml(item, indent + 2)
            .split("\n")
            .map(line => `${spaces}  ${line}`)
            .join("\n")}\n`;
        } else {
          result += `${spaces}- ${item}\n`;
        }
      });
      continue;
    }

    if (typeof value === "object") {
      result += `${spaces}${key}:\n${toYaml(value, indent + 2)}`;
      continue;
    }

    if (
      typeof value === "string" &&
      (value.includes(":") || value.includes("#") || value.includes("'") || value.includes('"') || value.includes("\n"))
    ) {
      result += `${spaces}${key}: "${value.replace(/"/g, '\\"')}"\n`;
      continue;
    }

    result += `${spaces}${key}: ${value}\n`;
  }

  return result;
}

function getPipeline(buildId) {
  /**
   * Helpers
   */

  const getKey = platform => {
    const { os, arch, baseline } = platform;

    if (baseline) {
      return `${os}-${arch}-baseline`;
    }

    return `${os}-${arch}`;
  };

  const getLabel = platform => {
    const { os, arch, baseline } = platform;

    if (baseline) {
      return `:${os}: ${arch}-baseline`;
    }

    return `:${os}: ${arch}`;
  };

  // https://buildkite.com/docs/pipelines/command-step#retry-attributes
  const getRetry = (limit = 3) => {
    return {
      automatic: [
        { exit_status: 1, limit: 1 },
        { exit_status: -1, limit },
        { exit_status: 255, limit },
        { signal_reason: "agent_stop", limit },
      ],
    };
  };

  // https://buildkite.com/docs/pipelines/managing-priorities
  const getPriority = () => {
    if (isFork()) {
      return -1;
    }
    if (isMainBranch()) {
      return 2;
    }
    if (isMergeQueue()) {
      return 1;
    }
    return 0;
  };

  /**
   * Steps
   */

  const getBuildVendorStep = platform => {
    const { os, arch, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-vendor`,
      label: `${getLabel(platform)} - build-vendor`,
      agents: {
        os,
        arch,
        queue: `build-${os}`,
      },
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        ENABLE_BASELINE: baseline ? "ON" : "OFF",
      },
      command: "bun run build:ci --target dependencies",
    };
  };

  const getBuildCppStep = platform => {
    const { os, arch, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-cpp`,
      label: `${getLabel(platform)} - build-cpp`,
      agents: {
        os,
        arch,
        queue: `build-${os}`,
      },
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_CPP_ONLY: "ON",
        ENABLE_BASELINE: baseline ? "ON" : "OFF",
      },
      command: "bun run build:ci --target bun",
    };
  };

  const getBuildZigStep = platform => {
    const { os, arch, baseline } = platform;
    const toolchain = baseline ? `${os}-${arch}-baseline` : `${os}-${arch}`;

    return {
      key: `${getKey(platform)}-build-zig`,
      label: `${getLabel(platform)} - build-zig`,
      agents: {
        queue: "build-zig",
      },
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        ENABLE_BASELINE: baseline ? "ON" : "OFF",
      },
      command: `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
    };
  };

  const getBuildBunStep = platform => {
    const { os, arch, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-bun`,
      label: `${getLabel(platform)} - build-bun`,
      depends_on: [
        `${getKey(platform)}-build-vendor`,
        `${getKey(platform)}-build-cpp`,
        `${getKey(platform)}-build-zig`,
      ],
      agents: {
        os,
        arch,
        queue: `build-${os}`,
      },
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_LINK_ONLY: "ON",
        ENABLE_BASELINE: baseline ? "ON" : "OFF",
      },
      command: "bun run build:ci --target bun",
    };
  };

  const getTestBunStep = platform => {
    const { os, arch, distro, release } = platform;

    let name;
    if (os === "darwin" || os === "windows") {
      name = getLabel(platform);
    } else {
      name = getLabel({ ...platform, os: distro });
    }

    let agents;
    if (os === "darwin") {
      agents = { os, arch, queue: `test-darwin` };
    } else if (os === "windows") {
      agents = { os, arch, robobun: true };
    } else {
      agents = { os, arch, distro, release, robobun: true };
    }

    let command;
    if (os === "windows") {
      command = `node .\\scripts\\runner.node.mjs --step ${getKey(platform)}-build-bun`;
    } else {
      command = `./scripts/runner.node.mjs --step ${getKey(platform)}-build-bun`;
    }

    let parallelism;
    if (os === "darwin") {
      parallelism = 2;
    } else {
      parallelism = 10;
    }

    let depends;
    let env;
    if (buildId) {
      env = {
        BUILDKITE_ARTIFACT_BUILD_ID: buildId,
      };
    } else {
      depends = [`${getKey(platform)}-build-bun`];
    }

    return {
      key: `${getKey(platform)}-${distro}-${release.replace(/\./g, "")}-test-bun`,
      label: `${name} - test-bun`,
      depends_on: depends,
      agents,
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      soft_fail: isMainBranch(),
      parallelism,
      command,
      env,
    };
  };

  /**
   * Config
   */

  const buildPlatforms = [
    { os: "darwin", arch: "aarch64" },
    { os: "darwin", arch: "x64" },
    { os: "linux", arch: "aarch64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "x64", baseline: true },
    { os: "windows", arch: "x64" },
    { os: "windows", arch: "x64", baseline: true },
  ];

  const testPlatforms = [
    { os: "darwin", arch: "aarch64", distro: "sonoma", release: "14" },
    { os: "darwin", arch: "aarch64", distro: "ventura", release: "13" },
    { os: "darwin", arch: "x64", distro: "sonoma", release: "14" },
    { os: "darwin", arch: "x64", distro: "ventura", release: "13" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "12" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "x64", distro: "debian", release: "12" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "x64", distro: "debian", release: "12", baseline: true },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04", baseline: true },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04", baseline: true },
    { os: "windows", arch: "x64", distro: "server", release: "2019" },
    { os: "windows", arch: "x64", distro: "server", release: "2019", baseline: true },
  ];

  return {
    priority: getPriority(),
    steps: [
      ...buildPlatforms.map(platform => {
        const { os, arch, baseline } = platform;

        let steps = [
          ...testPlatforms
            .filter(platform => platform.os === os && platform.arch === arch && baseline === platform.baseline)
            .map(platform => getTestBunStep(platform)),
        ];

        if (!buildId) {
          steps.unshift(
            getBuildVendorStep(platform),
            getBuildCppStep(platform),
            getBuildZigStep(platform),
            getBuildBunStep(platform),
          );
        }

        return {
          key: getKey(platform),
          group: getLabel(platform),
          steps,
        };
      }),
    ],
  };
}

async function main() {
  console.log("Checking environment...");
  console.log(" - Repository:", getRepository());
  console.log(" - Branch:", getBranch());
  console.log(" - Commit:", getCommit());
  console.log(" - Commit Message:", getCommitMessage());
  console.log(" - Is Main Branch:", isMainBranch());
  console.log(" - Is Merge Queue:", isMergeQueue());
  console.log(" - Is Pull Request:", isPullRequest());

  const changedFiles = await getChangedFiles();
  if (changedFiles) {
    console.log(
      `Found ${changedFiles.length} changed files: \n${changedFiles.map(filename => ` - ${filename}`).join("\n")}`,
    );
  }

  const isDocumentationFile = filename => /^(\.vscode|\.github|bench|docs|examples)|\.(md)$/i.test(filename);

  const isSkip = () => {
    const message = getCommitMessage();
    if (/\[(skip ci|no ci|ci skip|ci no)\]/i.test(message)) {
      return true;
    }
    return changedFiles && changedFiles.every(filename => isDocumentationFile(filename));
  };

  if (isSkip()) {
    console.log("Skipping CI due to commit message or changed files...");
    return;
  }

  const isTestFile = filename => /^test/i.test(filename) || /runner\.node\.mjs$/i.test(filename);

  const isSkipBuild = () => {
    const message = getCommitMessage();
    if (/\[(only tests?|tests? only|skip build|no build|build skip|build no)\]/i.test(message)) {
      return true;
    }
    return changedFiles && changedFiles.every(filename => isTestFile(filename) || isDocumentationFile(filename));
  };

  let buildId;
  if (isSkipBuild()) {
    buildId = await getBuildIdWithArtifacts();
    if (buildId) {
      console.log("Skipping build due to commit message or changed files...");
      console.log("Using build artifacts from previous build:", buildId);
    } else {
      console.log("Attempted to skip build, but could not find previous build");
    }
  }

  const pipeline = getPipeline(buildId);
  const content = toYaml(pipeline);
  const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
  writeFileSync(contentPath, content);

  console.log("Generated pipeline:");
  console.log(" - Path:", contentPath);
  console.log(" - Size:", (content.length / 1024).toFixed(), "KB");
}

await main();
