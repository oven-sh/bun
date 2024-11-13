#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCanaryRevision,
  getChangedFiles,
  getCommit,
  getCommitMessage,
  getLastSuccessfulBuild,
  getMainBranch,
  getRepositoryOwner,
  getTargetBranch,
  isBuildkite,
  isFork,
  isMainBranch,
  isMergeQueue,
  printEnvironment,
  spawnSafe,
} from "../scripts/utils.mjs";

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

/**
 * @typedef PipelineOptions
 * @property {string} [buildId]
 * @property {boolean} [buildImages]
 */

/**
 * @param {PipelineOptions} options
 */
function getPipeline(options) {
  const { buildId, buildImages } = options;

  /**
   * Helpers
   */

  const getEmoji = text => {
    if (text === "amazonlinux") {
      return ":aws:";
    }
    return `:${text}:`;
  };

  const getKey = platform => {
    const { os, arch, abi, baseline, distro, release } = platform;

    let key = `${os}-${arch}`;
    if (abi) {
      key += `-${abi}`;
    }
    if (baseline) {
      key += "-baseline";
    }
    if (distro) {
      key += `-${distro}`;
    }
    if (release) {
      key += `-${release.replace(/\./g, "")}`;
    }

    return key;
  };

  const getLabel = platform => {
    const { os, distro, arch, abi, baseline, release } = platform;
    const emoji = getEmoji(distro || os);
    let label = release ? `${emoji} ${release} ${arch}` : `${emoji} ${arch}`;
    if (abi) {
      label += `-${abi}`;
    }
    if (baseline) {
      label += `-baseline`;
    }
    return label;
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

  const getBuildImageStep = platform => {
    const { os, arch, distro, release } = platform;

    return {
      key: `${getKey(platform)}-build-image`,
      label: `${getLabel(platform)} - build-image`,
      agents: {
        queue: "build-image",
      },
      env: {
        DEBUG: "1",
      },
      command: `node ./scripts/machine.mjs --cloud=aws --os=${os} --arch=${arch} --distro=${distro} --distro-version=${release}`,
    };
  };

  const getBuildVendorStep = platform => {
    const { os, arch, abi, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-vendor`,
      label: `${getLabel(platform)} - build-vendor`,
      agents: {
        os,
        arch,
        abi,
        queue: abi ? `build-${os}-${abi}` : `build-${os}`,
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
    const { os, arch, abi, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-cpp`,
      label: `${getLabel(platform)} - build-cpp`,
      agents: {
        os,
        arch,
        abi,
        queue: abi ? `build-${os}-${abi}` : `build-${os}`,
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
    const { os, arch, abi, baseline } = platform;
    const toolchain = getKey(platform);

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
    const { os, arch, abi, baseline } = platform;

    return {
      key: `${getKey(platform)}-build-bun`,
      label: `build-bun ${getLabel(platform)}`,
      depends_on: [
        `${getKey(platform)}-build-vendor`,
        `${getKey(platform)}-build-cpp`,
        `${getKey(platform)}-build-zig`,
      ],
      agents: {
        os,
        arch,
        abi,
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
    const { os, arch, abi, distro, release } = platform;

    let name;
    if (os === "darwin" || os === "windows") {
      name = getLabel({ ...platform, release });
    } else {
      name = getLabel({ ...platform, os: distro, release });
    }

    let agents;
    if (os === "darwin") {
      agents = { os, arch, abi, queue: `test-darwin` };
    } else if (os === "windows") {
      agents = { os, arch, abi, robobun: true };
    } else {
      agents = { os, arch, abi, distro, release, robobun: true };
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

    let retry;
    if (os !== "windows") {
      // When the runner fails on Windows, Buildkite only detects an exit code of 1.
      // Because of this, we don't know if the run was fatal, or soft-failed.
      retry = getRetry();
    }

    return {
      key: `${getKey(platform)}-${distro}-${release.replace(/\./g, "")}-test-bun`,
      label: `${name} - test-bun`,
      depends_on: depends,
      agents,
      retry,
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
    { os: "linux", arch: "aarch64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "aarch64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "musl" },
  ];

  const testPlatforms = [
    { os: "linux", arch: "aarch64", distro: "debian", release: "12" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "10" },
    { os: "linux", arch: "x64", distro: "debian", release: "12" },
    { os: "linux", arch: "x64", distro: "debian", release: "11" },
    { os: "linux", arch: "x64", distro: "debian", release: "10" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2023" },
    // { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2" },
    { os: "linux", arch: "x64", distro: "amazonlinux", release: "2023" },
    // { os: "linux", arch: "x64", distro: "amazonlinux", release: "2" },
    { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
    { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.17" },
    { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
    { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.17" },
  ];

  return {
    priority: getPriority(),
    steps: [
      ...buildPlatforms.map(platform => {
        const { os, arch, abi, baseline } = platform;
        const platforms = testPlatforms.filter(
          platform =>
            platform.os === os && platform.arch === arch && abi === platform.abi && baseline === platform.baseline,
        );

        let steps = [];

        if (buildImages) {
          steps.push(...platforms.map(platform => getBuildImageStep(platform)));
        } else {
          steps.push(...platforms.map(platform => getTestBunStep(platform)));
        }

        if (!buildId && !buildImages) {
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
  printEnvironment();

  console.log("Checking last successful build...");
  const lastBuild = await getLastSuccessfulBuild();
  if (lastBuild) {
    const { id, path, commit_id: commit } = lastBuild;
    console.log(" - Build ID:", id);
    console.log(" - Build URL:", new URL(path, "https://buildkite.com/").toString());
    console.log(" - Commit:", commit);
  } else {
    console.log(" - No build found");
  }

  let changedFiles;
  if (!isFork()) {
    console.log("Checking changed files...");
    const baseRef = getCommit();
    console.log(" - Base Ref:", baseRef);
    const headRef = lastBuild?.commit_id || getTargetBranch() || getMainBranch();
    console.log(" - Head Ref:", headRef);

    changedFiles = await getChangedFiles(undefined, baseRef, headRef);
    if (changedFiles) {
      if (changedFiles.length) {
        changedFiles.forEach(filename => console.log(` - ${filename}`));
      } else {
        console.log(" - No changed files");
      }
    }
  }

  const isDocumentationFile = filename => /^(\.vscode|\.github|bench|docs|examples)|\.(md)$/i.test(filename);
  const isTestFile = filename => /^test/i.test(filename) || /runner\.node\.mjs$/i.test(filename);

  console.log("Checking if CI should be forced...");
  let forceBuild;
  {
    const message = getCommitMessage();
    const match = /\[(force ci|ci force|ci force build)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      forceBuild = true;
    }
  }

  console.log("Checking if CI should be skipped...");
  if (!forceBuild) {
    const message = getCommitMessage();
    const match = /\[(skip ci|no ci|ci skip|ci no)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      return;
    }
    if (changedFiles && changedFiles.every(filename => isDocumentationFile(filename))) {
      console.log(" - Yes, because all changed files are documentation");
      return;
    }
  }

  console.log("Checking if CI should re-build images...");
  let buildImages;
  {
    const message = getCommitMessage();
    const match = /\[(build images?|images? build)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      buildImages = true;
    }
  }

  console.log("Checking if build should be skipped...");
  let skipBuild;
  if (!forceBuild) {
    const message = getCommitMessage();
    const match = /\[(only tests?|tests? only|skip build|no build|build skip|build no)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      skipBuild = true;
    }
    if (changedFiles && changedFiles.every(filename => isTestFile(filename) || isDocumentationFile(filename))) {
      console.log(" - Yes, because all changed files are tests or documentation");
      skipBuild = true;
    }
  }

  console.log("Checking if build is a named release...");
  let buildRelease;
  {
    const message = getCommitMessage();
    const match = /\[(release|release build|build release)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      buildRelease = true;
    }
  }

  console.log("Generating pipeline...");
  const pipeline = getPipeline({
    buildId: lastBuild && skipBuild && !forceBuild ? lastBuild.id : undefined,
    buildImages,
  });

  const content = toYaml(pipeline);
  const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
  writeFileSync(contentPath, content);

  console.log("Generated pipeline:");
  console.log(" - Content:", content);
  console.log(" - Path:", contentPath);
  console.log(" - Size:", (content.length / 1024).toFixed(), "KB");

  if (isBuildkite) {
    console.log("Setting canary revision...");
    const canaryRevision = buildRelease ? 0 : await getCanaryRevision();
    await spawnSafe(["buildkite-agent", "meta-data", "set", "canary", `${canaryRevision}`]);

    console.log("Uploading pipeline...");
    await spawnSafe(["buildkite-agent", "pipeline", "upload", contentPath]);
  }
}

await main();
