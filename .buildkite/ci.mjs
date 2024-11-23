#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getBootstrapVersion,
  getBuildNumber,
  getCanaryRevision,
  getChangedFiles,
  getCommit,
  getCommitMessage,
  getEnv,
  getLastSuccessfulBuild,
  getMainBranch,
  getTargetBranch,
  isBuildkite,
  isFork,
  isMainBranch,
  isMergeQueue,
  printEnvironment,
  spawnSafe,
  toYaml,
  uploadArtifact,
} from "../scripts/utils.mjs";
import { platform } from "node:os";

/**
 * @typedef PipelineOptions
 * @property {string} [buildId]
 * @property {boolean} [buildImages]
 * @property {boolean} [publishImages]
 * @property {boolean} [skipTests]
 */

/**
 * @param {PipelineOptions} options
 */
function getPipeline(options) {
  const { buildId, buildImages, publishImages, skipTests } = options;

  /**
   * Helpers
   */

  /**
   * @param {string} text
   * @returns {string}
   * @link https://github.com/buildkite/emojis#emoji-reference
   */
  const getEmoji = string => {
    if (string === "amazonlinux") {
      return ":aws:";
    }
    return `:${string}:`;
  };

  /**
   * @typedef {"linux" | "darwin" | "windows"} Os
   * @typedef {"aarch64" | "x64"} Arch
   * @typedef {"musl"} Abi
   */

  /**
   * @typedef Target
   * @property {Os} os
   * @property {Arch} arch
   * @property {Abi} [abi]
   * @property {boolean} [baseline]
   */

  /**
   * @param {Target} target
   * @returns {string}
   */
  const getTargetKey = target => {
    const { os, arch, abi, baseline } = target;
    let key = `${os}-${arch}`;
    if (abi) {
      key += `-${abi}`;
    }
    if (baseline) {
      key += "-baseline";
    }
    return key;
  };

  /**
   * @param {Target} target
   * @returns {string}
   */
  const getTargetLabel = target => {
    const { os, arch, abi, baseline } = target;
    let label = `${getEmoji(os)} ${arch}`;
    if (abi) {
      label += `-${abi}`;
    }
    if (baseline) {
      label += "-baseline";
    }
    return label;
  };

  /**
   * @typedef {1 | 2 | 3 | 4} Tier
   * - 1 is the latest release
   * - 2 are previous releases
   * - 3 is the oldest release
   * - 4 is EOL or a super old release
   */

  /**
   * @typedef Platform
   * @property {Os} os
   * @property {Arch} arch
   * @property {Abi} [abi]
   * @property {boolean} [baseline]
   * @property {string} [distro]
   * @property {string} release
   * @property {Tier} [tier]
   */

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  const getPlatformKey = platform => {
    const { os, arch, abi, baseline, distro, release } = platform;
    const target = getTargetKey({ os, arch, abi, baseline });
    if (distro) {
      return `${target}-${distro}-${release.replace(/\./g, "")}`;
    }
    return `${target}-${release.replace(/\./g, "")}`;
  };

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  const getPlatformLabel = platform => {
    const { os, arch, baseline, distro, release } = platform;
    let label = `${getEmoji(distro || os)} ${release} ${arch}`;
    if (baseline) {
      label += "-baseline";
    }
    return label;
  };

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  const getImageKey = platform => {
    const { os, arch, distro, release } = platform;
    if (distro) {
      return `${os}-${arch}-${distro}-${release.replace(/\./g, "")}`;
    }
    return `${os}-${arch}-${release.replace(/\./g, "")}`;
  };

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  const getImageLabel = platform => {
    const { os, arch, distro, release } = platform;
    return `${getEmoji(distro || os)} ${release} ${arch}`;
  };

  /**
   * @param {number} [limit]
   * @link https://buildkite.com/docs/pipelines/command-step#retry-attributes
   */
  const getRetry = (limit = 0) => {
    return {
      automatic: [
        { exit_status: 1, limit },
        { exit_status: -1, limit: 3 },
        { exit_status: 255, limit: 3 },
        { signal_reason: "agent_stop", limit: 3 },
      ],
    };
  };

  /**
   * @returns {number}
   * @link https://buildkite.com/docs/pipelines/managing-priorities
   */
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
   * @param {Target} target
   * @returns {Record<string, string | undefined>}
   */
  const getBuildEnv = target => {
    const { baseline, abi } = target;
    return {
      ENABLE_BASELINE: baseline ? "ON" : "OFF",
      ABI: abi === "musl" ? "musl" : undefined,
    };
  };

  /**
   * @param {Target} target
   * @returns {string}
   */
  const getBuildToolchain = target => {
    const { os, arch, abi, baseline } = target;
    let key = `${os}-${arch}`;
    if (abi) {
      key += `-${abi}`;
    }
    if (baseline) {
      key += "-baseline";
    }
    return key;
  };

  /**
   * Agents
   */

  /**
   * @typedef {Record<string, string | undefined>} Agent
   */

  /**
   * @param {Platform} platform
   * @returns {boolean}
   */
  const isUsingNewAgent = platform => {
    const { os } = platform;
    if (os === "linux" || os === "windows") {
      return true;
    }
    return false;
  };

  /**
   * @param {"v1" | "v2"} version
   * @param {Platform} platform
   * @param {string} [instanceType]
   * @param {number} [cpuCount]
   * @returns {Agent}
   */
  const getEmphemeralAgent = (version, platform, instanceType, cpuCount) => {
    const { os, arch, abi, distro, release } = platform;
    if (version === "v1") {
      return {
        robobun: true,
        os,
        arch,
        distro,
        release,
      };
    }
    let image;
    if (distro) {
      image = `${os}-${arch}-${distro}-${release}`;
    } else {
      image = `${os}-${arch}-${release}`;
    }
    if (buildImages && !publishImages) {
      image += `-build-${getBuildNumber()}`;
    } else {
      image += `-v${getBootstrapVersion(os)}`;
    }
    return {
      robobun: true,
      robobun2: true,
      os,
      arch,
      abi,
      distro,
      release,
      "image-name": image,
      "instance-type": instanceType,
      "cpu-count": cpuCount,
    };
  };

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  const getEmphemeralBuildAgent = platform => {
    const { arch } = platform;
    const instanceType = arch === "aarch64" ? "c8g.8xlarge" : "c7i.8xlarge";
    const cpuCount = 32;
    return getEmphemeralAgent("v2", platform, instanceType, cpuCount);
  };

  /**
   * @param {Platform} platform
   * @returns {Agent}
   */
  const getEmphemeralTestAgent = platform => {
    const { os, arch } = platform;
    let instanceType;
    let cpuCount;
    if (os === "windows") {
      // TODO: `dev-server-ssr-110.test.ts` and `next-build.test.ts` run out of memory
      // at 8GB of memory, so use 16GB instead.
      instanceType = "c7i.2xlarge";
      cpuCount = 8;
    } else if (arch === "aarch64") {
      instanceType = "c8g.xlarge";
      cpuCount = 4;
    } else {
      instanceType = "c7i.xlarge";
      cpuCount = 4;
    }
    return getEmphemeralAgent("v2", platform, instanceType, cpuCount);
  };

  /**
   * @param {Target} target
   * @returns {Agent}
   */
  const getBuildAgent = target => {
    const { os, arch, abi } = target;
    if (isUsingNewAgent(target)) {
      return getEmphemeralBuildAgent(target);
    }
    return {
      queue: `build-${os}`,
      os,
      arch,
      abi,
    };
  };

  /**
   * @param {Target} target
   * @returns {Agent}
   */
  const getZigAgent = platform => {
    const { arch } = platform;
    const instanceType = arch === "aarch64" ? "c8g.2xlarge" : "c7i.2xlarge";
    return {
      robobun: true,
      robobun2: true,
      os: "linux",
      arch,
      distro: "debian",
      release: "11",
      "image-name": `linux-${arch}-debian-11-v5`, // v5 is not on main yet
      "instance-type": instanceType,
    };
    // TODO: Temporarily disable due to configuration
    // return {
    //   queue: "build-zig",
    // };
  };

  /**
   * @param {Platform} platform
   * @returns {Agent}
   */
  const getTestAgent = platform => {
    const { os, arch, release } = platform;
    if (isUsingNewAgent(platform)) {
      return getEmphemeralTestAgent(platform);
    }
    if (os === "darwin") {
      return {
        os,
        arch,
        release,
        queue: "test-darwin",
      };
    }
    return getEmphemeralAgent("v1", platform);
  };

  /**
   * Steps
   */

  /**
   * @typedef Step
   * @property {string} key
   * @property {string} [label]
   * @property {Record<string, string | undefined>} [agents]
   * @property {Record<string, string | undefined>} [env]
   * @property {string} command
   * @property {string[]} [depends_on]
   * @property {Record<string, string | undefined>} [retry]
   * @property {boolean} [cancel_on_build_failing]
   * @property {boolean} [soft_fail]
   * @property {number} [parallelism]
   * @property {number} [concurrency]
   * @property {string} [concurrency_group]
   * @property {number} [priority]
   * @property {number} [timeout_in_minutes]
   * @link https://buildkite.com/docs/pipelines/command-step
   */

  /**
   * @param {Platform} platform
   * @param {string} [step]
   * @returns {string[]}
   */
  const getDependsOn = (platform, step) => {
    if (imagePlatforms.has(getImageKey(platform))) {
      const key = `${getImageKey(platform)}-build-image`;
      if (key !== step) {
        return [key];
      }
    }
    return [];
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getBuildImageStep = platform => {
    const { os, arch, distro, release } = platform;
    const action = publishImages ? "publish-image" : "create-image";
    const command = [
      "node",
      "./scripts/machine.mjs",
      action,
      `--os=${os}`,
      `--arch=${arch}`,
      distro && `--distro=${distro}`,
      `--distro-version=${release}`,
      "--cloud=aws",
      "--ci",
      "--authorized-org=oven-sh",
    ];
    return {
      key: `${getImageKey(platform)}-build-image`,
      label: `${getImageLabel(platform)} - build-image`,
      agents: {
        queue: "build-image",
      },
      env: {
        DEBUG: "1",
      },
      retry: getRetry(),
      command: command.filter(Boolean).join(" "),
      timeout_in_minutes: os === "windows" ? 3 * 60 : 60,
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getBuildVendorStep = platform => {
    return {
      key: `${getTargetKey(platform)}-build-vendor`,
      label: `${getTargetLabel(platform)} - build-vendor`,
      depends_on: getDependsOn(platform),
      agents: getBuildAgent(platform),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: getBuildEnv(platform),
      command: "bun run build:ci --target dependencies",
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getBuildCppStep = platform => {
    return {
      key: `${getTargetKey(platform)}-build-cpp`,
      label: `${getTargetLabel(platform)} - build-cpp`,
      depends_on: getDependsOn(platform),
      agents: getBuildAgent(platform),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_CPP_ONLY: "ON",
        ...getBuildEnv(platform),
      },
      command: "bun run build:ci --target bun",
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getBuildZigStep = platform => {
    const toolchain = getBuildToolchain(platform);
    return {
      key: `${getTargetKey(platform)}-build-zig`,
      label: `${getTargetLabel(platform)} - build-zig`,
      depends_on: getDependsOn(platform),
      agents: getZigAgent(platform),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: getBuildEnv(platform),
      command: `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getBuildBunStep = platform => {
    return {
      key: `${getTargetKey(platform)}-build-bun`,
      label: `${getTargetLabel(platform)} - build-bun`,
      depends_on: [
        `${getTargetKey(platform)}-build-vendor`,
        `${getTargetKey(platform)}-build-cpp`,
        `${getTargetKey(platform)}-build-zig`,
      ],
      agents: getBuildAgent(platform),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_LINK_ONLY: "ON",
        ...getBuildEnv(platform),
      },
      command: "bun run build:ci --target bun",
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Step}
   */
  const getTestBunStep = platform => {
    const { os } = platform;
    let command;
    if (os === "windows") {
      command = `node .\\scripts\\runner.node.mjs --step ${getTargetKey(platform)}-build-bun`;
    } else {
      command = `./scripts/runner.node.mjs --step ${getTargetKey(platform)}-build-bun`;
    }
    let parallelism;
    if (os === "darwin") {
      parallelism = 2;
    } else {
      parallelism = 10;
    }
    let env;
    let depends = [];
    if (buildId) {
      env = {
        BUILDKITE_ARTIFACT_BUILD_ID: buildId,
      };
    } else {
      depends = [`${getTargetKey(platform)}-build-bun`];
    }
    let retry;
    if (os !== "windows") {
      // When the runner fails on Windows, Buildkite only detects an exit code of 1.
      // Because of this, we don't know if the run was fatal, or soft-failed.
      retry = getRetry(1);
    }
    let soft_fail;
    if (isMainBranch()) {
      soft_fail = true;
    } else {
      soft_fail = [{ exit_status: 2 }];
    }
    return {
      key: `${getPlatformKey(platform)}-test-bun`,
      label: `${getPlatformLabel(platform)} - test-bun`,
      depends_on: [...depends, ...getDependsOn(platform)],
      agents: getTestAgent(platform),
      retry,
      cancel_on_build_failing: isMergeQueue(),
      soft_fail,
      parallelism,
      command,
      env,
    };
  };

  /**
   * Config
   */

  /**
   * @type {Platform[]}
   */
  const buildPlatforms = [
    // { os: "darwin", arch: "aarch64", release: "14" },
    // { os: "darwin", arch: "x64", release: "14" },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
    // { os: "linux", arch: "x64", distro: "debian", release: "11" },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11" },
    // { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
    // { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
    // { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20" },
    // { os: "windows", arch: "x64", release: "2019" },
    { os: "windows", arch: "x64", baseline: true, release: "2019" },
  ];

  /**
   * @type {Platform[]}
   */
  const testPlatforms = [
    // { os: "darwin", arch: "aarch64", release: "15", tier: 1 },
    // { os: "darwin", arch: "aarch64", release: "14", tier: 1 },
    // { os: "darwin", arch: "aarch64", release: "13", tier: 2 },
    // { os: "darwin", arch: "x64", release: "15", tier: 1 },
    // { os: "darwin", arch: "x64", release: "14", tier: 1 },
    // { os: "darwin", arch: "x64", release: "13", tier: 2 },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "12", tier: 1 },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "11", tier: 2 },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "10", tier: 3 },
    // { os: "linux", arch: "x64", distro: "debian", release: "12", tier: 1 },
    // { os: "linux", arch: "x64", distro: "debian", release: "11", tier: 2 },
    // { os: "linux", arch: "x64", distro: "debian", release: "10", tier: 3 },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "12", tier: 1 },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11", tier: 2 },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "10", tier: 3 },
    // { os: "linux", arch: "aarch64", distro: "ubuntu", release: "24.04", tier: 1 },
    // { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04", tier: 2 },
    // { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04", tier: 3 },
    // { os: "linux", arch: "x64", distro: "ubuntu", release: "24.04", tier: 1 },
    // { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04", tier: 2 },
    // { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04", tier: 3 },
    // { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "24.04", tier: 1 },
    // { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "22.04", tier: 2 },
    // { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "20.04", tier: 3 },
    // { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2023", tier: 1 },
    // { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2", tier: 3 },
    // { os: "linux", arch: "x64", distro: "amazonlinux", release: "2023", tier: 1 },
    // { os: "linux", arch: "x64", distro: "amazonlinux", release: "2", tier: 3 },
    // { os: "linux", arch: "x64", baseline: true, distro: "amazonlinux", release: "2023", tier: 1 },
    // { os: "linux", arch: "x64", baseline: true, distro: "amazonlinux", release: "2", tier: 3 },
    // { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20", tier: 1 },
    // { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20", tier: 1 },
    // { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20", tier: 1 },
    // { os: "windows", arch: "x64", release: "2019", tier: 1 },
    { os: "windows", arch: "x64", release: "2025", baseline: true, tier: 1 },
    { os: "windows", arch: "x64", release: "2022", baseline: true, tier: 2 },
    { os: "windows", arch: "x64", release: "2019", baseline: true, tier: 3 },
  ];

  const imagePlatforms = new Map(
    [...buildPlatforms, ...testPlatforms]
      .filter(platform => buildImages && isUsingNewAgent(platform))
      .map(platform => [getImageKey(platform), platform]),
  );

  /**
   * @type {Step[]}
   */
  const steps = [];

  if (imagePlatforms.size) {
    steps.push({
      group: ":docker:",
      steps: [...imagePlatforms.values()].map(platform => getBuildImageStep(platform)),
    });
  }

  for (const platform of buildPlatforms) {
    const { os, arch, abi, baseline } = platform;

    /** @type {Step[]} */
    const platformSteps = [];

    if (buildImages || !buildId) {
      platformSteps.push(
        getBuildVendorStep(platform),
        getBuildCppStep(platform),
        getBuildZigStep(platform),
        getBuildBunStep(platform),
      );
    }

    if (!skipTests) {
      platformSteps.push(
        ...testPlatforms
          .filter(
            testPlatform =>
              testPlatform.os === os &&
              testPlatform.arch === arch &&
              testPlatform.abi === abi &&
              testPlatform.baseline === baseline,
          )
          .map(testPlatform => getTestBunStep(testPlatform)),
      );
    }

    if (!platformSteps.length) {
      continue;
    }

    steps.push({
      key: getTargetKey(platform),
      group: getTargetLabel(platform),
      steps: platformSteps,
    });
  }

  if (isMainBranch() && !isFork()) {
    steps.push({
      label: ":github:",
      agents: {
        queue: "test-darwin",
      },
      depends_on: buildPlatforms.map(platform => `${getTargetKey(platform)}-build-bun`),
      command: ".buildkite/scripts/upload-release.sh",
    });
  }

  return {
    priority: getPriority(),
    steps,
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
  let changedFilesBranch;
  if (!isFork() && !isMainBranch()) {
    console.log("Checking changed files...");
    const targetRef = getTargetBranch();
    console.log(" - Target Ref:", targetRef);
    const baseRef = lastBuild?.commit_id || targetRef || getMainBranch();
    console.log(" - Base Ref:", baseRef);
    const headRef = getCommit();
    console.log(" - Head Ref:", headRef);

    changedFiles = await getChangedFiles(undefined, baseRef, headRef);
    changedFilesBranch = await getChangedFiles(undefined, targetRef, headRef);
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
    if (changedFiles) {
      const imageFiles = ["scripts/bootstrap.sh", "scripts/bootstrap.ps1"];
      const changedImageFiles = changedFiles.filter(filename => imageFiles.includes(filename));
      if (changedImageFiles.length) {
        console.log(" - Yes, because the list of changed files contains:", changedImageFiles.join(", "));
        buildImages = true;
      }
    }
  }

  console.log("Checking if CI should publish images...");
  let publishImages;
  {
    const message = getCommitMessage();
    const match = /\[(publish images?|images? publish)\]/i.exec(message);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      publishImages = true;
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

  console.log("Checking if tests should be skipped...");
  let skipTests;
  {
    const message = getCommitMessage();
    const match = /\[(skip tests?|tests? skip|no tests?|tests? no)\]/i.exec(message);
    if (match) {
      console.log(" - Yes, because commit message contains:", match[1]);
      skipTests = true;
    }
    if (isMainBranch()) {
      console.log(" - Yes, because we're on main branch");
      skipTests = true;
    }
  }

  console.log("Checking if build is a named release...");
  let buildRelease;
  if (/^(1|true|on|yes)$/i.test(getEnv("RELEASE", false))) {
    console.log(" - Yes, because RELEASE environment variable is set");
    buildRelease = true;
  } else {
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
    publishImages,
    skipTests,
  });

  const content = toYaml(pipeline);
  const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
  writeFileSync(contentPath, content);

  console.log("Generated pipeline:");
  console.log(" - Path:", contentPath);
  console.log(" - Size:", (content.length / 1024).toFixed(), "KB");
  if (isBuildkite) {
    await uploadArtifact(contentPath);
  }

  if (isBuildkite) {
    console.log("Setting canary revision...");
    const canaryRevision = buildRelease ? 0 : await getCanaryRevision();
    await spawnSafe(["buildkite-agent", "meta-data", "set", "canary", `${canaryRevision}`], { stdio: "inherit" });

    console.log("Uploading pipeline...");
    await spawnSafe(["buildkite-agent", "pipeline", "upload", contentPath], { stdio: "inherit" });
  }
}

await main();
