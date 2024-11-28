#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { join } from "node:path";
import {
  isBuildkite,
  getMainBranch,
  getTargetBranch,
  getChangedFiles,
  getCommit,
  getCommitMessage,
  isFork,
  isMainBranch,
  isMergeQueue,
  getBootstrapVersion,
  getBuildNumber,
  getCanaryRevision,
  getEnv,
  getLastSuccessfulBuild,
  spawnSafe,
  writeFile,
  toYaml,
  uploadArtifact,
  printEnvironment,
  isBuildManual,
  startGroup,
  getBuildMetadata,
  parseBoolean,
  getEmoji,
  getBuildkiteEmoji,
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
 * @property {boolean} [canary]
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
  if (profile) {
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
  if (profile) {
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
 * @property {boolean} [canary]
 * @property {Profile} [profile]
 * @property {Distro} [distro]
 * @property {string} release
 * @property {Tier} [tier]
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
  { os: "darwin", arch: "aarch64", release: "14", tier: "latest" },
  { os: "darwin", arch: "aarch64", release: "13", tier: "previous" },
  { os: "darwin", arch: "x64", release: "14", tier: "latest" },
  { os: "darwin", arch: "x64", release: "13", tier: "previous" },
  { os: "linux", arch: "aarch64", distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "aarch64", distro: "debian", release: "11", tier: "previous" },
  { os: "linux", arch: "x64", distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "x64", distro: "debian", release: "11", tier: "previous" },
  { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "12", tier: "latest" },
  { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11", tier: "previous" },
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
  { os: "windows", arch: "x64", release: "2025", tier: "latest" },
  { os: "windows", arch: "x64", release: "2022", tier: "previous" },
  { os: "windows", arch: "x64", release: "2019", tier: "oldest" },
  { os: "windows", arch: "x64", release: "2025", baseline: true, tier: "latest" },
  { os: "windows", arch: "x64", release: "2022", baseline: true, tier: "previous" },
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
  if (profile) {
    label += `-${profile}`;
  }
  return label;
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getImageKey(platform) {
  const { os, arch, distro, release } = platform;
  const version = release.replace(/\./g, "");
  if (distro) {
    return `${os}-${arch}-${distro}-${version}`;
  }
  return `${os}-${arch}-${version}`;
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
 * @param {boolean} [dryRun]
 * @returns {string}
 */
function getImageName(platform, dryRun) {
  const { os, arch, distro, release } = platform;
  const name = distro ? `${os}-${arch}-${distro}-${release}` : `${os}-${arch}-${release}`;
  if (dryRun) {
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
    automatic: [
      { exit_status: 1, limit },
      { exit_status: -1, limit: 3 },
      { exit_status: 255, limit: 3 },
      { signal_reason: "agent_stop", limit: 3 },
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
 */

/**
 * @param {Platform} platform
 * @param {Ec2Options} options
 * @returns {Agent}
 */
function getEc2Agent(platform, options) {
  const { os, arch, abi, distro, release } = platform;
  const { instanceType, cpuCount } = options;
  return {
    os,
    arch,
    abi,
    distro,
    release,
    // The agent is created by robobun, see more details here:
    // https://github.com/oven-sh/robobun/blob/d46c07e0ac5ac0f9ffe1012f0e98b59e1a0d387a/src/robobun.ts#L1707
    robobun: true,
    robobun2: true,
    "image-name": getImageName(platform),
    "instance-type": instanceType,
    "cpu-count": cpuCount,
    "preemptible": true,
  };
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getCppAgent(platform) {
  const { os, arch } = platform;

  if (os === "darwin") {
    return {
      queue: `build-${os}`,
      os,
      arch,
    };
  }

  return getEc2Agent(platform, {
    instanceType: arch === "aarch64" ? "c8g.16xlarge" : "c7i.16xlarge",
    cpuCount: 64,
  });
}

/**
 * @param {Platform} platform
 * @returns {Agent}
 */
function getZigAgent(platform) {
  const { arch } = platform;

  // return {
  //   queue: "build-zig",
  // };

  return getEc2Agent(
    {
      os: "linux",
      arch,
      distro: "debian",
      release: "11",
    },
    {
      instanceType: arch === "aarch64" ? "c8g.2xlarge" : "c7i.2xlarge",
      cpuCount: 8,
    },
  );
}

/**
 * @param {Platform} platform
 * @returns {Agent}
 */
function getTestAgent(platform) {
  const { os, arch } = platform;

  if (os === "darwin") {
    return {
      queue: `test-${os}`,
      os,
      arch,
    };
  }

  // TODO: `dev-server-ssr-110.test.ts` and `next-build.test.ts` run out of memory
  // at 8GB of memory, so use 16GB instead.
  if (os === "windows") {
    return getEc2Agent(platform, {
      instanceType: "c7i.2xlarge",
      cpuCount: 8,
    });
  }

  return getEc2Agent(platform, {
    instanceType: arch === "aarch64" ? "c8g.xlarge" : "c7i.xlarge",
    cpuCount: 4,
  });
}

/**
 * Steps
 */

/**
 * @param {Target} target
 * @returns {Record<string, string | undefined>}
 */
function getBuildEnv(target) {
  const { profile, baseline, canary, abi } = target;
  const release = !profile;

  return {
    CMAKE_BUILD_TYPE: release ? "Release" : profile === "debug" ? "Debug" : "RelWithDebInfo",
    ENABLE_BASELINE: baseline ? "ON" : "OFF",
    ENABLE_CANARY: canary ? "ON" : "OFF",
    ENABLE_ASSERTIONS: release ? "OFF" : "ON",
    ENABLE_LOGS: release ? "OFF" : "ON",
    ABI: abi === "musl" ? "musl" : undefined,
  };
}

/**
 * @param {Platform} platform
 * @returns {Step}
 */
function getBuildVendorStep(platform) {
  return {
    key: `${getTargetKey(platform)}-build-vendor`,
    label: `${getTargetLabel(platform)} - build-vendor`,
    agents: getCppAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform),
    command: "bun run build:ci --target dependencies",
  };
}

/**
 * @param {Platform} platform
 * @returns {Step}
 */
function getBuildCppStep(platform) {
  return {
    key: `${getTargetKey(platform)}-build-cpp`,
    label: `${getTargetLabel(platform)} - build-cpp`,
    agents: getCppAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: {
      BUN_CPP_ONLY: "ON",
      ...getBuildEnv(platform),
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
 * @returns {Step}
 */
function getBuildZigStep(platform) {
  const toolchain = getBuildToolchain(platform);
  return {
    key: `${getTargetKey(platform)}-build-zig`,
    label: `${getTargetLabel(platform)} - build-zig`,
    agents: getZigAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform),
    command: `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
  };
}

/**
 * @param {Platform} platform
 * @returns {Step}
 */
function getLinkBunStep(platform) {
  return {
    key: `${getTargetKey(platform)}-build-bun`,
    label: `${getTargetLabel(platform)} - build-bun`,
    depends_on: [
      `${getTargetKey(platform)}-build-vendor`,
      `${getTargetKey(platform)}-build-cpp`,
      `${getTargetKey(platform)}-build-zig`,
    ],
    agents: getCppAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: {
      BUN_LINK_ONLY: "ON",
      ...getBuildEnv(platform),
    },
    command: "bun run build:ci --target bun",
  };
}

/**
 * @param {Platform} platform
 * @returns {Step}
 */
function getBuildBunStep(platform) {
  return {
    key: `${getTargetKey(platform)}-build-bun`,
    label: `${getTargetLabel(platform)} - build-bun`,
    agents: getCppAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    env: getBuildEnv(platform),
    command: "bun run build:ci",
  };
}

/**
 * @typedef {Object} TestOptions
 * @property {string} [buildId]
 * @property {boolean} [unifiedTests]
 * @property {string[]} [testFiles]
 */

/**
 * @param {Platform} platform
 * @param {TestOptions} [options]
 * @returns {Step}
 */
function getTestBunStep(platform, options = {}) {
  const { os } = platform;
  const { buildId, unifiedTests, testFiles } = options;

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
    agents: getTestAgent(platform),
    cancel_on_build_failing: isMergeQueue(),
    retry: getRetry(),
    soft_fail: isMainBranch() ? true : [{ exit_status: 2 }],
    parallelism: unifiedTests ? undefined : os === "darwin" ? 2 : 10,
    command:
      os === "windows"
        ? `node .\\scripts\\runner.node.mjs ${args.join(" ")}`
        : `./scripts/runner.node.mjs ${args.join(" ")}`,
  };
}

/**
 * @param {Platform} platform
 * @param {boolean} [dryRun]
 * @returns {Step}
 */
function getBuildImageStep(platform, dryRun) {
  const { os, arch, distro, release } = platform;
  const action = dryRun ? "create-image" : "publish-image";
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
    timeout_in_minutes: 3 * 60,
  };
}

/**
 * @param {Platform[]} [buildPlatforms]
 * @returns {Step}
 */
function getReleaseStep(buildPlatforms) {
  return {
    key: "release",
    label: getBuildkiteEmoji("release"),
    agents: {
      queue: "test-darwin",
    },
    command: ".buildkite/scripts/upload-release.sh",
  };
}

// async function main() {
//   printEnvironment();

//   console.log("Checking last successful build...");
//   const lastBuild = await getLastSuccessfulBuild();
//   if (lastBuild) {
//     const { id, path, commit_id: commit } = lastBuild;
//     console.log(" - Build ID:", id);
//     console.log(" - Build URL:", new URL(path, "https://buildkite.com/").toString());
//     console.log(" - Commit:", commit);
//   } else {
//     console.log(" - No build found");
//   }

//   let changedFiles;
//   // FIXME: Fix various bugs when calculating changed files
//   // false -> !isFork() && !isMainBranch()
//   if (false) {
//     console.log("Checking changed files...");
//     const baseRef = lastBuild?.commit_id || getTargetBranch() || getMainBranch();
//     console.log(" - Base Ref:", baseRef);
//     const headRef = getCommit();
//     console.log(" - Head Ref:", headRef);

//     changedFiles = await getChangedFiles(undefined, baseRef, headRef);
//     if (changedFiles) {
//       if (changedFiles.length) {
//         changedFiles.forEach(filename => console.log(` - ${filename}`));
//       } else {
//         console.log(" - No changed files");
//       }
//     }
//   }

//   const isDocumentationFile = filename => /^(\.vscode|\.github|bench|docs|examples)|\.(md)$/i.test(filename);
//   const isTestFile = filename => /^test/i.test(filename) || /runner\.node\.mjs$/i.test(filename);

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
 * @property {boolean} [canary]
 * @property {Profile[]} [buildProfiles]
 * @property {Platform[]} [buildPlatforms]
 * @property {Platform[]} [testPlatforms]
 * @property {string[]} [testFiles]
 * @property {boolean} [unifiedBuilds]
 * @property {boolean} [unifiedTests]
 */

/**
 * @param {Step} step
 * @param {(string | Step | undefined)[]} dependsOn
 * @returns {Step}
 */
function getStepWithDependsOn(step, ...dependsOn) {
  const { depends_on: existingDependsOn = [] } = step;
  const newDependsOn = dependsOn.filter(Boolean).map(item => (typeof item === "string" ? item : item.key));
  return {
    ...step,
    depends_on: [...existingDependsOn, ...newDependsOn],
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
  const isManual = false;
  isBuildManual();
  if (isManual && !process.argv.includes("--apply")) {
    return;
  }

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
      canary: parseBoolean(options["canary"]),
      skipBuilds: parseBoolean(options["skip-builds"]),
      forceBuilds: parseBoolean(options["force-builds"]),
      skipTests: parseBoolean(options["skip-tests"]),
      testFiles: parseArray(options["test-files"]),
      buildImages: parseBoolean(options["build-images"]),
      publishImages: parseBoolean(options["publish-images"]),
      unifiedBuilds: parseBoolean(options["unified-builds"]),
      unifiedTests: parseBoolean(options["unified-tests"]),
      buildProfiles: parseArray(options["build-profiles"]),
      buildPlatforms: buildPlatformKeys?.length
        ? buildPlatformKeys.map(key => buildPlatformsMap.get(key))
        : Array.from(buildPlatformsMap.values()),
      testPlatforms: testPlatformKeys?.length
        ? testPlatformKeys.map(key => testPlatformsMap.get(key))
        : Array.from(testPlatformsMap.values()),
    };
  }

  const commitMessage = getCommitMessage();

  /**
   * @param {RegExp} pattern
   * @returns {string | boolean}
   */
  const parseOption = pattern => {
    const match = pattern.test(commitMessage);
    if (match) {
      const [, value] = match;
      return value;
    }
    return false;
  };

  return {
    canary:
      !parseBoolean(getEnv("RELEASE", false) || "false") &&
      !/\[(release|build release|release build)\]/i.test(commitMessage),
    skipEverything: parseOption(/\[(skip ci|no ci)\]/i),
    skipBuilds: parseOption(/\[(skip builds?|no builds?|only tests?)\]/i),
    forceBuilds: parseOption(/\[(force builds?)\]/i),
    skipTests: parseOption(/\[(skip tests?|no tests?|only builds?)\]/i),
    buildImages: parseOption(/\[(build images?)\]/i),
    publishImages: parseOption(/\[(publish images?)\]/i),
    buildPlatforms: Array.from(buildPlatformsMap.values()),
    testPlatforms: Array.from(testPlatformsMap.values()),
    buildProfiles: ["release"],
  };
}

/**
 * @param {PipelineOptions} [options]
 * @returns {Promise<Pipeline>}
 */
async function getPipeline(options = {}) {
  if (isBuildManual() && !Object.keys(options).length) {
    return {
      steps: [getOptionsStep(), getOptionsApplyStep()],
    };
  }

  const { skipEverything } = options;
  if (skipEverything) {
    return {};
  }

  const { buildProfiles = [], buildPlatforms = [], testPlatforms = [], buildImages, publishImages } = options;
  const imagePlatforms = new Map(
    buildImages || publishImages ? buildPlatforms.map(platform => [getImageKey(platform), platform]) : [],
  );

  /** @type {Step[]} */
  const steps = [];

  if (imagePlatforms.size) {
    steps.push({
      key: "build-images",
      group: getBuildkiteEmoji("aws"),
      steps: [...imagePlatforms.values()].map(platform => getBuildImageStep(platform, !publishImages)),
    });
  }

  const { skipBuilds, forceBuilds, unifiedBuilds } = options;
  if (!skipBuilds || forceBuilds) {
    steps.push(
      ...buildPlatforms
        .flatMap(platform => buildProfiles.map(profile => ({ ...platform, profile })))
        .map(target => {
          const imageKey = getImageKey(target);
          const imageStep = imagePlatforms.get(imageKey);

          return getStepWithDependsOn(
            {
              key: getTargetKey(target),
              group: getTargetLabel(target),
              steps: unifiedBuilds
                ? [getBuildBunStep(target)]
                : [
                    getBuildVendorStep(target),
                    getBuildCppStep(target),
                    getBuildZigStep(target),
                    getLinkBunStep(target),
                  ],
            },
            imageStep,
          );
        }),
    );
  }

  const { skipTests, forceTests, unifiedTests, testFiles } = options;
  if (!skipTests || forceTests) {
    steps.push(
      ...testPlatforms
        .flatMap(platform => buildProfiles.map(profile => ({ ...platform, profile })))
        .map(target => ({
          key: getTargetKey(target),
          group: getTargetLabel(target),
          steps: [getTestBunStep(target, { unifiedTests, testFiles })],
        })),
    );
  }

  if (isMainBranch()) {
    steps.push(getReleaseStep(buildPlatforms));
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
