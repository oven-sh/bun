#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { join } from "node:path";
import {
  getBootstrapVersion,
  getBuildkiteEmoji,
  getBuildMetadata,
  getBuildNumber,
  getCanaryRevision,
  getCommitMessage,
  getEmoji,
  getEnv,
  getLastSuccessfulBuild,
  isBuildkite,
  isBuildManual,
  isFork,
  isMainBranch,
  isMergeQueue,
  parseBoolean,
  spawnSafe,
  startGroup,
  toYaml,
  uploadArtifact,
  writeFile,
} from "../scripts/utils.mjs";

/**
 * @typedef {"linux" | "darwin" | "windows"} Os
 * @typedef {"aarch64" | "x64"} Arch
 * @typedef {"musl"} Abi
 * @typedef {"debian" | "ubuntu" | "alpine" | "amazonlinux"} Distro
 * @typedef {"latest" | "previous" | "oldest" | "eol"} Tier
 * @typedef {"release" | "assert" | "debug"} Profile
 */

/**
 * @typedef Target
 * @property {Os} os
 * @property {Arch} arch
 * @property {Abi} [abi]
 * @property {boolean} [baseline]
 * @property {Profile} [profile]
 */

/**
 * @param {Target} target
 * @returns {string}
 */
function getTargetKey(target) {
  const { os, arch, abi, baseline, profile } = target;
  let key = `${os}-${arch}`;
  if (abi) {
    key += `-${abi}`;
  }
  if (baseline) {
    key += "-baseline";
  }
  if (profile && profile !== "release") {
    key += `-${profile}`;
  }
  return key;
}

/**
 * @param {Target} target
 * @returns {string}
 */
function getTargetLabel(target) {
  const { os, arch, abi, baseline, profile } = target;
  let label = `${getBuildkiteEmoji(os)} ${arch}`;
  if (abi) {
    label += `-${abi}`;
  }
  if (baseline) {
    label += "-baseline";
  }
  if (profile && profile !== "release") {
    label += `-${profile}`;
  }
  return label;
}

/**
 * @typedef Platform
 * @property {Os} os
 * @property {Arch} arch
 * @property {Abi} [abi]
 * @property {boolean} [baseline]
 * @property {Profile} [profile]
 * @property {Distro} [distro]
 * @property {string} release
 * @property {Tier} [tier]
 * @property {string[]} [features]
 */

/**
 * @type {Platform[]}
 */
const buildPlatforms = [
  { os: "darwin", arch: "aarch64", release: "14" },
  { os: "darwin", arch: "x64", release: "14" },
  { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2023", features: ["docker"] },
  { os: "linux", arch: "x64", distro: "amazonlinux", release: "2023", features: ["docker"] },
  { os: "linux", arch: "x64", baseline: true, distro: "amazonlinux", release: "2023", features: ["docker"] },
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
  { os: "darwin", arch: "aarch64", release: "14", tier: "latest" },
  { os: "darwin", arch: "aarch64", release: "13", tier: "previous" },
  { os: "darwin", arch: "x64", release: "14", tier: "latest" },
  { os: "darwin", arch: "x64", release: "13", tier: "previous" },
  { os: "linux", arch: "aarch64", distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "x64", distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "aarch64", distro: "ubuntu", release: "24.04", tier: "latest" },
  { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04", tier: "previous" },
  { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04", tier: "oldest" },
  { os: "linux", arch: "x64", distro: "ubuntu", release: "24.04", tier: "latest" },
  { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04", tier: "previous" },
  { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04", tier: "oldest" },
  { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "24.04", tier: "latest" },
  { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "22.04", tier: "previous" },
  { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "20.04", tier: "oldest" },
  { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20", tier: "latest" },
  { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20", tier: "latest" },
  { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20", tier: "latest" },
  { os: "windows", arch: "x64", release: "2019", tier: "oldest" },
  { os: "windows", arch: "x64", release: "2019", baseline: true, tier: "oldest" },
];

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getPlatformKey(platform) {
  const { distro, release } = platform;
  const target = getTargetKey(platform);
  const version = release.replace(/\./g, "");
  if (distro) {
    return `${target}-${distro}-${version}`;
  }
  return `${target}-${version}`;
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getPlatformLabel(platform) {
  const { os, arch, baseline, profile, distro, release } = platform;
  let label = `${getBuildkiteEmoji(distro || os)} ${release} ${arch}`;
  if (baseline) {
    label += "-baseline";
  }
  if (profile && profile !== "release") {
    label += `-${profile}`;
  }
  return label;
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getImageKey(platform) {
  const { os, arch, distro, release, features, abi } = platform;
  const version = release.replace(/\./g, "");
  let key = `${os}-${arch}-${version}`;
  if (distro) {
    key += `-${distro}`;
  }
  if (features?.length) {
    key += `-with-${features.join("-")}`;
  }

  if (abi) {
    key += `-${abi}`;
  }

  return key;
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getImageLabel(platform) {
  const { os, arch, distro, release } = platform;
  return `${getBuildkiteEmoji(distro || os)} ${release} ${arch}`;
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {string}
 */
function getImageName(platform, options) {
  const { os } = platform;
  const { buildImages, publishImages } = options;

  const name = getImageKey(platform);

  if (buildImages && !publishImages) {
    return `${name}-build-${getBuildNumber()}`;
  }

  return `${name}-v${getBootstrapVersion(os)}`;
}

/**
 * @param {number} [limit]
 * @link https://buildkite.com/docs/pipelines/command-step#retry-attributes
 */
function getRetry(limit = 0) {
  return {
    manual: {
      permit_on_passed: true,
    },
    automatic: [
      { exit_status: 1, limit },
      { exit_status: -1, limit: 1 },
      { exit_status: 255, limit: 1 },
      { signal_reason: "cancel", limit: 1 },
      { signal_reason: "agent_stop", limit: 1 },
    ],
  };
}

/**
 * @returns {number}
 * @link https://buildkite.com/docs/pipelines/managing-priorities
 */
function getPriority() {
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
}

/**
 * Agents
 */

/**
 * @typedef {Object} Ec2Options
 * @property {string} instanceType
 * @property {number} cpuCount
 * @property {number} threadsPerCore
 * @property {boolean} dryRun
 */

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @param {Ec2Options} ec2Options
 * @returns {Agent}
 */
function getEc2Agent(platform, options, ec2Options) {
  const { os, arch, abi, distro, release } = platform;
  const { instanceType, cpuCount, threadsPerCore } = ec2Options;
  return {
    os,
    arch,
    abi,
    distro,
    release,
    robobun: true,
    robobun2: true,
    "image-name": getImageName(platform, options),
    "instance-type": instanceType,
    "cpu-count": cpuCount,
    "threads-per-core": threadsPerCore,
    "preemptible": false,
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {string}
 */
function getCppAgent(platform, options) {
  const { os, arch, distro } = platform;

  if (os === "darwin") {
    return {
      queue: `build-${os}`,
      os,
      arch,
    };
  }

  return getEc2Agent(platform, options, {
    instanceType: arch === "aarch64" ? "c8g.16xlarge" : "c7i.16xlarge",
    cpuCount: 32,
    threadsPerCore: 1,
  });
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Agent}
 */
function getZigAgent(platform, options) {
  const { arch } = platform;
  return {
    queue: "build-zig",
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Agent}
 */
function getTestAgent(platform, options) {
  const { os, arch } = platform;

  if (os === "darwin") {
    return {
      queue: `test-${os}`,
      os,
      arch,
    };
  }

  // TODO: `dev-server-ssr-110.test.ts` and `next-build.test.ts` run out of memory at 8GB of memory, so use 16GB instead.
  if (os === "windows") {
    return getEc2Agent(platform, options, {
      instanceType: "c7i.2xlarge",
      cpuCount: 2,
      threadsPerCore: 1,
    });
  }

  if (arch === "aarch64") {
    return getEc2Agent(platform, options, {
      instanceType: "c8g.xlarge",
      cpuCount: 2,
      threadsPerCore: 1,
    });
  }

  return getEc2Agent(platform, options, {
    instanceType: "c7i.xlarge",
    cpuCount: 2,
    threadsPerCore: 1,
  });
}

/**
 * Steps
 */

/**
 * @param {Target} target
 * @param {PipelineOptions} options
 * @returns {Record<string, string | undefined>}
 */
function getBuildEnv(target, options) {
  const { profile, baseline, abi } = target;
  const release = !profile || profile === "release";
  const { canary } = options;
  const revision = typeof canary === "number" ? canary : 1;

  return {
    CMAKE_BUILD_TYPE: release ? "Release" : profile === "debug" ? "Debug" : "RelWithDebInfo",
    ENABLE_BASELINE: baseline ? "ON" : "OFF",
    ENABLE_CANARY: revision > 0 ? "ON" : "OFF",
    CANARY_REVISION: revision,
    ENABLE_ASSERTIONS: release ? "OFF" : "ON",
    ENABLE_LOGS: release ? "OFF" : "ON",
    ABI: abi === "musl" ? "musl" : undefined,
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getBuildVendorStep(platform, options) {
  return {
    key: `${getTargetKey(platform)}-build-vendor`,
    label: `${getTargetLabel(platform)} - build-vendor`,
    agents: getCppAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform, options),
    command: "bun run build:ci --target dependencies",
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getBuildCppStep(platform, options) {
  return {
    key: `${getTargetKey(platform)}-build-cpp`,
    label: `${getTargetLabel(platform)} - build-cpp`,
    agents: getCppAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: {
      BUN_CPP_ONLY: "ON",
      ...getBuildEnv(platform, options),
    },
    command: "bun run build:ci --target bun",
  };
}

/**
 * @param {Target} target
 * @returns {string}
 */
function getBuildToolchain(target) {
  const { os, arch, abi, baseline } = target;
  let key = `${os}-${arch}`;
  if (abi) {
    key += `-${abi}`;
  }
  if (baseline) {
    key += "-baseline";
  }
  return key;
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getBuildZigStep(platform, options) {
  const toolchain = getBuildToolchain(platform);
  return {
    key: `${getTargetKey(platform)}-build-zig`,
    label: `${getTargetLabel(platform)} - build-zig`,
    agents: getZigAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform, options),
    command: `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
    timeout_in_minutes: 25,
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getLinkBunStep(platform, options) {
  return {
    key: `${getTargetKey(platform)}-build-bun`,
    label: `${getTargetLabel(platform)} - build-bun`,
    depends_on: [
      `${getTargetKey(platform)}-build-vendor`,
      `${getTargetKey(platform)}-build-cpp`,
      `${getTargetKey(platform)}-build-zig`,
    ],
    agents: getCppAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: {
      BUN_LINK_ONLY: "ON",
      ...getBuildEnv(platform, options),
    },
    command: "bun run build:ci --target bun",
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getBuildBunStep(platform, options) {
  return {
    key: `${getTargetKey(platform)}-build-bun`,
    label: `${getTargetLabel(platform)} - build-bun`,
    agents: getCppAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform, options),
    command: "bun run build:ci",
  };
}

/**
 * @typedef {Object} TestOptions
 * @property {string} [buildId]
 * @property {boolean} [unifiedTests]
 * @property {string[]} [testFiles]
 * @property {boolean} [dryRun]
 */

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @param {TestOptions} [testOptions]
 * @returns {Step}
 */
function getTestBunStep(platform, options, testOptions = {}) {
  const { os } = platform;
  const { buildId, unifiedTests, testFiles } = testOptions;

  const args = [`--step=${getTargetKey(platform)}-build-bun`];
  if (buildId) {
    args.push(`--build-id=${buildId}`);
  }
  if (testFiles) {
    args.push(...testFiles.map(testFile => `--include=${testFile}`));
  }

  const depends = [];
  if (!buildId) {
    depends.push(`${getTargetKey(platform)}-build-bun`);
  }

  return {
    key: `${getPlatformKey(platform)}-test-bun`,
    label: `${getPlatformLabel(platform)} - test-bun`,
    depends_on: depends,
    agents: getTestAgent(platform, options),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    parallelism: unifiedTests ? undefined : os === "darwin" ? 2 : 10,
    command:
      os === "windows"
        ? `node .\\scripts\\runner.node.mjs ${args.join(" ")}`
        : `./scripts/runner.node.mjs ${args.join(" ")}`,
  };
}

/**
 * @param {Platform} platform
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getBuildImageStep(platform, options) {
  const { os, arch, distro, release, features } = platform;
  const { publishImages } = options;
  const action = publishImages ? "publish-image" : "create-image";

  const command = [
    "node",
    "./scripts/machine.mjs",
    action,
    `--os=${os}`,
    `--arch=${arch}`,
    distro && `--distro=${distro}`,
    `--release=${release}`,
    "--cloud=aws",
    "--ci",
    "--authorized-org=oven-sh",
  ];
  for (const feature of features || []) {
    command.push(`--feature=${feature}`);
  }

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
    cancel_on_build_failing: isMergeQueue(),
    command: command.filter(Boolean).join(" "),
    timeout_in_minutes: 3 * 60,
  };
}

/**
 * @param {Platform[]} buildPlatforms
 * @param {PipelineOptions} options
 * @returns {Step}
 */
function getReleaseStep(buildPlatforms, options) {
  const { canary } = options;
  const revision = typeof canary === "number" ? canary : 1;

  return {
    key: "release",
    label: getBuildkiteEmoji("rocket"),
    agents: {
      queue: "test-darwin",
    },
    depends_on: buildPlatforms.map(platform => `${getTargetKey(platform)}-build-bun`),
    env: {
      CANARY: revision,
    },
    command: ".buildkite/scripts/upload-release.sh",
  };
}

/**
 * @typedef {Object} Pipeline
 * @property {Step[]} [steps]
 * @property {number} [priority]
 */

/**
 * @typedef {Record<string, string | undefined>} Agent
 */

/**
 * @typedef {GroupStep | CommandStep | BlockStep} Step
 */

/**
 * @typedef {Object} GroupStep
 * @property {string} key
 * @property {string} group
 * @property {Step[]} steps
 * @property {string[]} [depends_on]
 */

/**
 * @typedef {Object} CommandStep
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
 * @typedef {Object} BlockStep
 * @property {string} key
 * @property {string} block
 * @property {string} [prompt]
 * @property {"passed" | "failed" | "running"} [blocked_state]
 * @property {(SelectInput | TextInput)[]} [fields]
 */

/**
 * @typedef {Object} TextInput
 * @property {string} key
 * @property {string} text
 * @property {string} [default]
 * @property {boolean} [required]
 * @property {string} [hint]
 */

/**
 * @typedef {Object} SelectInput
 * @property {string} key
 * @property {string} select
 * @property {string | string[]} [default]
 * @property {boolean} [required]
 * @property {boolean} [multiple]
 * @property {string} [hint]
 * @property {SelectOption[]} [options]
 */

/**
 * @typedef {Object} SelectOption
 * @property {string} label
 * @property {string} value
 */

/**
 * @typedef {Object} PipelineOptions
 * @property {string | boolean} [skipEverything]
 * @property {string | boolean} [skipBuilds]
 * @property {string | boolean} [skipTests]
 * @property {string | boolean} [forceBuilds]
 * @property {string | boolean} [forceTests]
 * @property {string | boolean} [buildImages]
 * @property {string | boolean} [publishImages]
 * @property {number} [canary]
 * @property {Profile[]} [buildProfiles]
 * @property {Platform[]} [buildPlatforms]
 * @property {Platform[]} [testPlatforms]
 * @property {string[]} [testFiles]
 * @property {boolean} [unifiedBuilds]
 * @property {boolean} [unifiedTests]
 */

/**
 * @param {Step} step
 * @param {(string | undefined)[]} dependsOn
 * @returns {Step}
 */
function getStepWithDependsOn(step, ...dependsOn) {
  const { depends_on: existingDependsOn = [] } = step;
  return {
    ...step,
    depends_on: [...existingDependsOn, ...dependsOn.filter(Boolean)],
  };
}

/**
 * @returns {BlockStep}
 */
function getOptionsStep() {
  const booleanOptions = [
    {
      label: `${getEmoji("true")} Yes`,
      value: "true",
    },
    {
      label: `${getEmoji("false")} No`,
      value: "false",
    },
  ];

  return {
    key: "options",
    block: getBuildkiteEmoji("clipboard"),
    blocked_state: "running",
    fields: [
      {
        key: "canary",
        select: "If building, is this a canary build?",
        hint: "If you are building for a release, this should be false",
        required: false,
        default: "true",
        options: booleanOptions,
      },
      {
        key: "skip-builds",
        select: "Do you want to skip the build?",
        hint: "If true, artifacts will be downloaded from the last successful build",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "skip-tests",
        select: "Do you want to skip the tests?",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "force-builds",
        select: "Do you want to force run the build?",
        hint: "If true, the build will run even if no source files have changed",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "force-tests",
        select: "Do you want to force run the tests?",
        hint: "If true, the tests will run even if no test files have changed",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "build-profiles",
        select: "If building, which profiles do you want to build?",
        required: false,
        multiple: true,
        default: ["release"],
        options: [
          {
            label: `${getEmoji("release")} Release`,
            value: "release",
          },
          {
            label: `${getEmoji("assert")} Release with Assertions`,
            value: "assert",
          },
          {
            label: `${getEmoji("debug")} Debug`,
            value: "debug",
          },
        ],
      },
      {
        key: "build-platforms",
        select: "If building, which platforms do you want to build?",
        hint: "If this is left blank, all platforms are built",
        required: false,
        multiple: true,
        default: [],
        options: buildPlatforms.map(platform => {
          const { os, arch, abi, baseline } = platform;
          let label = `${getEmoji(os)} ${arch}`;
          if (abi) {
            label += `-${abi}`;
          }
          if (baseline) {
            label += `-baseline`;
          }
          return {
            label,
            value: getTargetKey(platform),
          };
        }),
      },
      {
        key: "test-platforms",
        select: "If testing, which platforms do you want to test?",
        hint: "If this is left blank, all platforms are tested",
        required: false,
        multiple: true,
        default: [],
        options: [...new Map(testPlatforms.map(platform => [getImageKey(platform), platform])).entries()].map(
          ([key, platform]) => {
            const { os, arch, abi, distro, release } = platform;
            let label = `${getEmoji(os)} ${arch}`;
            if (abi) {
              label += `-${abi}`;
            }
            if (distro) {
              label += ` ${distro}`;
            }
            if (release) {
              label += ` ${release}`;
            }
            return {
              label,
              value: key,
            };
          },
        ),
      },
      {
        key: "test-files",
        text: "If testing, which files do you want to test?",
        hint: "If specified, only run test paths that include the list of strings (e.g. 'test/js', 'test/cli/hot/watch.ts')",
        required: false,
      },
      {
        key: "build-images",
        select: "Do you want to re-build the base images?",
        hint: "This can take 2-3 hours to complete, only do so if you've tested locally",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "publish-images",
        select: "Do you want to re-build and publish the base images?",
        hint: "This can take 2-3 hours to complete, only do so if you've tested locally",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "unified-builds",
        select: "Do you want to build each platform in a single step?",
        hint: "If true, builds will not be split into seperate steps (this will likely slow down the build)",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "unified-tests",
        select: "Do you want to run tests in a single step?",
        hint: "If true, tests will not be split into seperate steps (this will be very slow)",
        required: false,
        default: "false",
        options: booleanOptions,
      },
    ],
  };
}

/**
 * @returns {Step}
 */
function getOptionsApplyStep() {
  const command = getEnv("BUILDKITE_COMMAND");
  return {
    key: "options-apply",
    label: getBuildkiteEmoji("gear"),
    command: `${command} --apply`,
    depends_on: ["options"],
    agents: {
      queue: getEnv("BUILDKITE_AGENT_META_DATA_QUEUE", false),
    },
  };
}

/**
 * @returns {Promise<PipelineOptions | undefined>}
 */
async function getPipelineOptions() {
  const isManual = isBuildManual();
  if (isManual && !process.argv.includes("--apply")) {
    return;
  }

  const canary = await getCanaryRevision();
  const buildPlatformsMap = new Map(buildPlatforms.map(platform => [getTargetKey(platform), platform]));
  const testPlatformsMap = new Map(testPlatforms.map(platform => [getPlatformKey(platform), platform]));

  if (isManual) {
    const { fields } = getOptionsStep();
    const keys = fields?.map(({ key }) => key) ?? [];
    const values = await Promise.all(keys.map(getBuildMetadata));
    const options = Object.fromEntries(keys.map((key, index) => [key, values[index]]));

    /**
     * @param {string} value
     * @returns {string[] | undefined}
     */
    const parseArray = value =>
      value
        ?.split("\n")
        ?.map(item => item.trim())
        ?.filter(Boolean);

    const buildPlatformKeys = parseArray(options["build-platforms"]);
    const testPlatformKeys = parseArray(options["test-platforms"]);
    return {
      canary: parseBoolean(options["canary"]) ? canary : 0,
      skipBuilds: parseBoolean(options["skip-builds"]),
      forceBuilds: parseBoolean(options["force-builds"]),
      skipTests: parseBoolean(options["skip-tests"]),
      buildImages: parseBoolean(options["build-images"]),
      publishImages: parseBoolean(options["publish-images"]),
      testFiles: parseArray(options["test-files"]),
      unifiedBuilds: parseBoolean(options["unified-builds"]),
      unifiedTests: parseBoolean(options["unified-tests"]),
      buildProfiles: parseArray(options["build-profiles"]),
      buildPlatforms: buildPlatformKeys?.length
        ? buildPlatformKeys.map(key => buildPlatformsMap.get(key))
        : Array.from(buildPlatformsMap.values()),
      testPlatforms: testPlatformKeys?.length
        ? testPlatformKeys.map(key => testPlatformsMap.get(key))
        : Array.from(testPlatformsMap.values()),
      dryRun: parseBoolean(options["dry-run"]),
    };
  }

  const commitMessage = getCommitMessage();

  /**
   * @param {RegExp} pattern
   * @returns {string | boolean}
   */
  const parseOption = pattern => {
    const match = pattern.exec(commitMessage);
    if (match) {
      const [, value] = match;
      return value;
    }
    return false;
  };

  const isCanary =
    !parseBoolean(getEnv("RELEASE", false) || "false") &&
    !/\[(release|build release|release build)\]/i.test(commitMessage);
  return {
    canary: isCanary ? canary : 0,
    skipEverything: parseOption(/\[(skip ci|no ci)\]/i),
    skipBuilds: parseOption(/\[(skip builds?|no builds?|only tests?)\]/i),
    forceBuilds: parseOption(/\[(force builds?)\]/i),
    skipTests: parseOption(/\[(skip tests?|no tests?|only builds?)\]/i),
    buildImages: parseOption(/\[(build images?)\]/i),
    dryRun: parseOption(/\[(dry run)\]/i),
    publishImages: parseOption(/\[(publish images?)\]/i),
    buildPlatforms: Array.from(buildPlatformsMap.values()),
    testPlatforms: Array.from(testPlatformsMap.values()),
    buildProfiles: ["release"],
  };
}

/**
 * @param {PipelineOptions} [options]
 * @returns {Promise<Pipeline | undefined>}
 */
async function getPipeline(options = {}) {
  const priority = getPriority();

  if (isBuildManual() && !Object.keys(options).length) {
    return {
      priority,
      steps: [getOptionsStep(), getOptionsApplyStep()],
    };
  }

  const { skipEverything } = options;
  if (skipEverything) {
    return;
  }

  const { buildProfiles = [], buildPlatforms = [], testPlatforms = [], buildImages, publishImages } = options;
  const imagePlatforms = new Map(
    buildImages || publishImages
      ? [...buildPlatforms, ...testPlatforms]
          .filter(({ os }) => os === "linux" || os === "windows")
          .map(platform => [getImageKey(platform), platform])
      : [],
  );

  /** @type {Step[]} */
  const steps = [];

  if (imagePlatforms.size) {
    steps.push({
      key: "build-images",
      group: getBuildkiteEmoji("aws"),
      steps: [...imagePlatforms.values()].map(platform => getBuildImageStep(platform, options)),
    });
  }

  let { skipBuilds, forceBuilds, unifiedBuilds, dryRun } = options;
  dryRun = dryRun || !!buildImages;

  /** @type {string | undefined} */
  let buildId;
  if (skipBuilds && !forceBuilds) {
    const lastBuild = await getLastSuccessfulBuild();
    if (lastBuild) {
      const { id } = lastBuild;
      buildId = id;
    } else {
      console.warn("No last successful build found, must force builds...");
    }
  }

  if (!buildId) {
    steps.push(
      ...buildPlatforms
        .flatMap(platform => buildProfiles.map(profile => ({ ...platform, profile })))
        .map(target => {
          const imageKey = getImageKey(target);

          return getStepWithDependsOn(
            {
              key: getTargetKey(target),
              group: getTargetLabel(target),
              steps: unifiedBuilds
                ? [getBuildBunStep(target, options)]
                : [
                    getBuildVendorStep(target, options),
                    getBuildCppStep(target, options),
                    getBuildZigStep(target, options),
                    getLinkBunStep(target, options),
                  ],
            },
            imagePlatforms.has(imageKey) ? `${imageKey}-build-image` : undefined,
          );
        }),
    );
  }

  if (!isMainBranch()) {
    const { skipTests, forceTests, unifiedTests, testFiles } = options;
    if (!skipTests || forceTests) {
      steps.push(
        ...testPlatforms
          .flatMap(platform => buildProfiles.map(profile => ({ ...platform, profile })))
          .map(target => ({
            key: getTargetKey(target),
            group: getTargetLabel(target),
            steps: [getTestBunStep(target, options, { unifiedTests, testFiles, buildId })],
          })),
      );
    }
  }

  if (isMainBranch()) {
    steps.push(getReleaseStep(buildPlatforms, options));
  }

  /** @type {Map<string, GroupStep>} */
  const stepsByGroup = new Map();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!("group" in step)) {
      continue;
    }

    const { group, steps: groupSteps } = step;
    if (stepsByGroup.has(group)) {
      stepsByGroup.get(group).steps.push(...groupSteps);
    } else {
      stepsByGroup.set(group, step);
    }

    steps[i] = undefined;
  }

  return {
    priority,
    steps: [...steps.filter(step => typeof step !== "undefined"), ...Array.from(stepsByGroup.values())],
  };
}

async function main() {
  startGroup("Generating options...");
  const options = await getPipelineOptions();
  if (options) {
    console.log("Generated options:", options);
  }

  startGroup("Generating pipeline...");
  const pipeline = await getPipeline(options);
  if (!pipeline) {
    console.log("Generated pipeline is empty, skipping...");
    return;
  }

  const content = toYaml(pipeline);
  const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
  writeFile(contentPath, content);

  console.log("Generated pipeline:");
  console.log(" - Path:", contentPath);
  console.log(" - Size:", (content.length / 1024).toFixed(), "KB");

  if (isBuildkite) {
    startGroup("Uploading pipeline...");
    try {
      await spawnSafe(["buildkite-agent", "pipeline", "upload", contentPath], { stdio: "inherit" });
    } finally {
      await uploadArtifact(contentPath);
    }
  }
}

await main();
