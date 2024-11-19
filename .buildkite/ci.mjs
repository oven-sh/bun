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
   * @typedef Platform
   * @property {Os} os
   * @property {Arch} arch
   * @property {Abi} [abi]
   * @property {boolean} [baseline]
   * @property {string} [distro]
   * @property {string} release
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
    const { os, distro } = platform;
    if (os === "linux" && distro === "alpine") {
      return true;
    }
    return false;
  };

  /**
   * @param {"v1" | "v2"} version
   * @param {Platform} platform
   * @param {string} [instanceType]
   * @returns {Agent}
   */
  const getEmphemeralAgent = (version, platform, instanceType) => {
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
      image += `-v${getBootstrapVersion()}`;
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
    };
  };

  /**
   * @param {Target} target
   * @returns {Agent}
   */
  const getBuildAgent = target => {
    const { os, arch, abi } = target;
    if (isUsingNewAgent(target)) {
      const instanceType = arch === "aarch64" ? "c8g.8xlarge" : "c7i.8xlarge";
      return getEmphemeralAgent("v2", target, instanceType);
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
  const getZigAgent = target => {
    const { abi, arch } = target;
    // if (abi === "musl") {
    //   const instanceType = arch === "aarch64" ? "c8g.large" : "c7i.large";
    //   return getEmphemeralAgent("v2", target, instanceType);
    // }
    return {
      queue: "build-zig",
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Agent}
   */
  const getTestAgent = platform => {
    const { os, arch, release } = platform;
    if (isUsingNewAgent(platform)) {
      const instanceType = arch === "aarch64" ? "t4g.large" : "t3.large";
      return getEmphemeralAgent("v2", platform, instanceType);
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
   * @returns {Step}
   */
  const getBuildImageStep = platform => {
    const { os, arch, distro, release } = platform;
    const action = publishImages ? "publish-image" : "create-image";
    return {
      key: `${getImageKey(platform)}-build-image`,
      label: `${getImageLabel(platform)} - build-image`,
      agents: {
        queue: "build-image",
      },
      env: {
        DEBUG: "1",
      },
      command: `node ./scripts/machine.mjs ${action} --ci --cloud=aws --os=${os} --arch=${arch} --distro=${distro} --distro-version=${release}`,
    };
  };

  /**
   * @param {Target} target
   * @returns {Step}
   */
  const getBuildVendorStep = target => {
    return {
      key: `${getTargetKey(target)}-build-vendor`,
      label: `${getTargetLabel(target)} - build-vendor`,
      agents: getBuildAgent(target),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: getBuildEnv(target),
      command: "bun run build:ci --target dependencies",
    };
  };

  /**
   * @param {Target} target
   * @returns {Step}
   */
  const getBuildCppStep = target => {
    return {
      key: `${getTargetKey(target)}-build-cpp`,
      label: `${getTargetLabel(target)} - build-cpp`,
      agents: getBuildAgent(target),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_CPP_ONLY: "ON",
        ...getBuildEnv(target),
      },
      command: "bun run build:ci --target bun",
    };
  };

  /**
   * @param {Target} target
   * @returns {Step}
   */
  const getBuildZigStep = target => {
    const toolchain = getBuildToolchain(target);
    return {
      key: `${getTargetKey(target)}-build-zig`,
      label: `${getTargetLabel(target)} - build-zig`,
      agents: getZigAgent(target),
      retry: getRetry(1), // FIXME: Sometimes zig build hangs, so we need to retry once
      cancel_on_build_failing: isMergeQueue(),
      env: getBuildEnv(target),
      command: `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
    };
  };

  /**
   * @param {Target} target
   * @returns {Step}
   */
  const getBuildBunStep = target => {
    return {
      key: `${getTargetKey(target)}-build-bun`,
      label: `${getTargetLabel(target)} - build-bun`,
      depends_on: [
        `${getTargetKey(target)}-build-vendor`,
        `${getTargetKey(target)}-build-cpp`,
        `${getTargetKey(target)}-build-zig`,
      ],
      agents: getBuildAgent(target),
      retry: getRetry(),
      cancel_on_build_failing: isMergeQueue(),
      env: {
        BUN_LINK_ONLY: "ON",
        ...getBuildEnv(target),
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
    let depends;
    let env;
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
    return {
      key: `${getPlatformKey(platform)}-test-bun`,
      label: `${getPlatformLabel(platform)} - test-bun`,
      depends_on: depends,
      agents: getTestAgent(platform),
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

  /**
   * @type {Platform[]}
   */
  const buildPlatforms = [
    { os: "darwin", arch: "aarch64", release: "14" },
    { os: "darwin", arch: "x64", release: "14" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
    { os: "linux", arch: "x64", distro: "debian", release: "11" },
    { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11" },
    { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
    { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
    { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20" },
    { os: "windows", arch: "x64", release: "2019" },
    { os: "windows", arch: "x64", baseline: true, release: "2019" },
  ];

  /**
   * @type {Platform[]}
   */
  const testPlatforms = [
    { os: "darwin", arch: "aarch64", release: "14" },
    { os: "darwin", arch: "aarch64", release: "13" },
    { os: "darwin", arch: "x64", release: "14" },
    { os: "darwin", arch: "x64", release: "13" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "12" },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
    // { os: "linux", arch: "aarch64", distro: "debian", release: "10" },
    { os: "linux", arch: "x64", distro: "debian", release: "12" },
    // { os: "linux", arch: "x64", distro: "debian", release: "11" },
    // { os: "linux", arch: "x64", distro: "debian", release: "10" },
    { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "12" },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11" },
    // { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "10" },
    // { os: "linux", arch: "aarch64", distro: "ubuntu", release: "24.04" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04" },
    // { os: "linux", arch: "x64", distro: "ubuntu", release: "24.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04" },
    // { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "24.04" },
    { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "20.04" },
    // { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2023" },
    // { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2" },
    // { os: "linux", arch: "x64", distro: "amazonlinux", release: "2023" },
    // { os: "linux", arch: "x64", distro: "amazonlinux", release: "2" },
    // { os: "linux", arch: "x64", baseline: true, distro: "amazonlinux", release: "2023" },
    // { os: "linux", arch: "x64", baseline: true, distro: "amazonlinux", release: "2" },
    { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
    // { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.17" },
    { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
    // { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.17" },
    { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20" },
    // { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.17" },
    { os: "windows", arch: "x64", release: "2019" },
    { os: "windows", arch: "x64", baseline: true, release: "2019" },
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

    if (imagePlatforms.has(getImageKey(platform))) {
      for (const step of platformSteps) {
        if (step.agents?.["image-name"]) {
          step.depends_on ??= [];
          step.depends_on.push(`${getImageKey(platform)}-build-image`);
        }
      }
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
  if (!isFork() && !isMainBranch()) {
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
