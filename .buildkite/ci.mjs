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
 * @returns {Agent}
 */
function getBuildAgent(platform) {
  const { os, arch, abi } = platform;
  return {
    queue: `build-${os}`,
    os,
    arch,
    abi,
  };
}

/**
 * @param {Platform} platform
 * @returns {string}
 */
function getCppAgent(platform) {
  const { os, arch } = platform;

  if (os === "darwin") {
    return getBuildAgent(platform);
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
      instanceType: arch === "aarch64" ? "c8g.2xlarge" : "c7i.2xlarge",
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
    // depends_on: getDependsOn(platform),
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
    depends_on: getDependsOn(platform),
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
    depends_on: getDependsOn(platform),
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
function getBuildBunStep(platform) {
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
}

/**
 * @param {Platform} platform
 * @returns {Step}
 */
function getTestBunStep(platform) {
  const { os } = platform;

  let env;
  let depends = [];
  if (buildId) {
    env = {
      BUILDKITE_ARTIFACT_BUILD_ID: buildId,
    };
  } else {
    depends = [`${getTargetKey(platform)}-build-bun`];
  }

  return {
    key: `${getPlatformKey(platform)}-test-bun`,
    label: `${getPlatformLabel(platform)} - test-bun`,
    depends_on: [...depends, ...getDependsOn(platform)],
    agents: getTestAgent(platform),
    cancel_on_build_failing: isMergeQueue(),
    retry: getRetry(),
    soft_fail: isMainBranch() ? true : [{ exit_status: 2 }],
    parallelism: os === "darwin" ? 2 : 10,
    command:
      os === "windows"
        ? `node .\\scripts\\runner.node.mjs --step ${getTargetKey(platform)}-build-bun`
        : `./scripts/runner.node.mjs --step ${getTargetKey(platform)}-build-bun`,
    env,
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
 * @param {string} string
 * @param {boolean} [buildkite]
 * @returns {string}
 * @link https://github.com/buildkite/emojis#emoji-reference
 */
function getBuildkiteEmoji(string, buildkite) {
  if (/darwin|mac|apple/i.test(string)) {
    return ":darwin:";
  }
  if (/amazon|aws/i.test(string)) {
    return ":aws:";
  }
  const match = string.match(/(linux|debian|ubuntu|alpine)/i);
  if (match) {
    const [, distro] = match;
    return `:${distro}:`;
  }
  if (/windows|win|microsoft/i.test(string)) {
    return ":windows:";
  }
  if (/true|yes|ok|pass|success/i.test(string)) {
    return ":white_check_mark:";
  }
  if (/false|no|fail|error|failure/i.test(string)) {
    return ":x:";
  }
  if (/gear|settings|configure/i.test(string)) {
    return ":gear:";
  }
  return "";
}

/**
 * @param {string} string
 * @returns {string}
 */
function getEmoji(string) {
  if (/darwin|mac|apple/i.test(string)) {
    return "🍎";
  }
  if (/linux|debian|ubuntu|alpine/i.test(string)) {
    return "🐧";
  }
  if (/windows|win|microsoft/i.test(string)) {
    return "🪟";
  }
  if (/true|yes|ok|pass|success/i.test(string)) {
    return "✅";
  }
  if (/false|no|fail|error|failure/i.test(string)) {
    return "❌";
  }
  if (/bug|debug/i.test(string)) {
    return "🐞";
  }
  if (/assert/i.test(string)) {
    return "🔍";
  }
  if (/release/i.test(string)) {
    return "🏆";
  }
  if (/gear|settings|configure/i.test(string)) {
    return "⚙️";
  }
  return "";
}

// /**
//  * @param {PipelineOptions} options
//  */
// function getPipeline(options) {
//   const { buildId, buildImages, publishImages, skipTests } = options;

//   /**
//    * Helpers
//    */

//   /**
//    * Agents
//    */

//   /**
//    * Steps
//    */

//   /**
//    * @param {Platform} platform
//    * @param {string} [step]
//    * @returns {string[]}
//    */
//   const getDependsOn = (platform, step) => {
//     if (imagePlatforms.has(getImageKey(platform))) {
//       const key = `${getImageKey(platform)}-build-image`;
//       if (key !== step) {
//         return [key];
//       }
//     }
//     return [];
//   };

//   /**
//    * Config
//    */

//   const imagePlatforms = new Map(
//     [...buildPlatforms, ...testPlatforms]
//       .filter(platform => buildImages && isUsingNewAgent(platform))
//       .map(platform => [getImageKey(platform), platform]),
//   );

//   /**
//    * @type {Step[]}
//    */
//   const steps = [];

//   if (imagePlatforms.size) {
//     steps.push({
//       group: ":docker:",
//       steps: [...imagePlatforms.values()].map(platform => getBuildImageStep(platform)),
//     });
//   }

//   for (const platform of buildPlatforms) {
//     const { os, arch, abi, baseline } = platform;

//     /** @type {Step[]} */
//     const platformSteps = [];

//     if (buildImages || !buildId) {
//       platformSteps.push(
//         getBuildVendorStep(platform),
//         getBuildCppStep(platform),
//         getBuildZigStep(platform),
//         getBuildBunStep(platform),
//       );
//     }

//     if (!skipTests) {
//       platformSteps.push(
//         ...testPlatforms
//           .filter(
//             testPlatform =>
//               testPlatform.os === os &&
//               testPlatform.arch === arch &&
//               testPlatform.abi === abi &&
//               testPlatform.baseline === baseline,
//           )
//           .map(testPlatform => getTestBunStep(testPlatform)),
//       );
//     }

//     if (!platformSteps.length) {
//       continue;
//     }

//     steps.push({
//       key: getTargetKey(platform),
//       group: getTargetLabel(platform),
//       steps: platformSteps,
//     });
//   }

//   if (isMainBranch() && !isFork()) {
//     steps.push({
//       label: ":github:",
//       agents: {
//         queue: "test-darwin",
//       },
//       depends_on: buildPlatforms.map(platform => `${getTargetKey(platform)}-build-bun`),
//       command: ".buildkite/scripts/upload-release.sh",
//     });
//   }

//   return {
//     priority: getPriority(),
//     steps,
//   };
// }

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

//   console.log("Checking if CI should be forced...");
//   let forceBuild;
//   {
//     const message = getCommitMessage();
//     const match = /\[(force ci|ci force|ci force build)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       forceBuild = true;
//     }
//   }

//   console.log("Checking if CI should be skipped...");
//   if (!forceBuild) {
//     const message = getCommitMessage();
//     const match = /\[(skip ci|no ci|ci skip|ci no)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       return;
//     }
//     if (changedFiles && changedFiles.every(filename => isDocumentationFile(filename))) {
//       console.log(" - Yes, because all changed files are documentation");
//       return;
//     }
//   }

//   console.log("Checking if CI should re-build images...");
//   let buildImages;
//   {
//     const message = getCommitMessage();
//     const match = /\[(build images?|images? build)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       buildImages = true;
//     }
//     if (changedFiles) {
//       const imageFiles = ["scripts/bootstrap.sh", "scripts/bootstrap.ps1"];
//       const changedImageFiles = changedFiles.filter(filename => imageFiles.includes(filename));
//       if (changedImageFiles.length) {
//         console.log(" - Yes, because the list of changed files contains:", changedImageFiles.join(", "));
//         buildImages = true;
//       }
//     }
//   }

//   console.log("Checking if CI should publish images...");
//   let publishImages;
//   {
//     const message = getCommitMessage();
//     const match = /\[(publish images?|images? publish)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       publishImages = true;
//       buildImages = true;
//     }
//   }

//   console.log("Checking if build should be skipped...");
//   let skipBuild;
//   if (!forceBuild) {
//     const message = getCommitMessage();
//     const match = /\[(only tests?|tests? only|skip build|no build|build skip|build no)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       skipBuild = true;
//     }
//     if (changedFiles && changedFiles.every(filename => isTestFile(filename) || isDocumentationFile(filename))) {
//       console.log(" - Yes, because all changed files are tests or documentation");
//       skipBuild = true;
//     }
//   }

//   console.log("Checking if tests should be skipped...");
//   let skipTests;
//   {
//     const message = getCommitMessage();
//     const match = /\[(skip tests?|tests? skip|no tests?|tests? no)\]/i.exec(message);
//     if (match) {
//       console.log(" - Yes, because commit message contains:", match[1]);
//       skipTests = true;
//     }
//     if (isMainBranch()) {
//       console.log(" - Yes, because we're on main branch");
//       skipTests = true;
//     }
//   }

//   console.log("Checking if build is a named release...");
//   let buildRelease;
//   if (/^(1|true|on|yes)$/i.test(getEnv("RELEASE", false))) {
//     console.log(" - Yes, because RELEASE environment variable is set");
//     buildRelease = true;
//   } else {
//     const message = getCommitMessage();
//     const match = /\[(release|release build|build release)\]/i.exec(message);
//     if (match) {
//       const [, reason] = match;
//       console.log(" - Yes, because commit message contains:", reason);
//       buildRelease = true;
//     }
//   }

//   console.log("Generating pipeline...");
//   const pipeline = getPipeline({
//     buildId: lastBuild && skipBuild && !forceBuild ? lastBuild.id : undefined,
//     buildImages,
//     publishImages,
//     skipTests,
//   });

//   const content = toYaml(pipeline);
//   const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
//   writeFile(contentPath, content);

//   console.log("Generated pipeline:");
//   console.log(" - Path:", contentPath);
//   console.log(" - Size:", (content.length / 1024).toFixed(), "KB");
//   if (isBuildkite) {
//     await uploadArtifact(contentPath);
//   }

//   if (isBuildkite) {
//     console.log("Setting canary revision...");
//     const canaryRevision = buildRelease ? 0 : await getCanaryRevision();
//     await spawnSafe(["buildkite-agent", "meta-data", "set", "canary", `${canaryRevision}`], { stdio: "inherit" });

//     console.log("Uploading pipeline...");
//     await spawnSafe(["buildkite-agent", "pipeline", "upload", contentPath], { stdio: "inherit" });
//   }
// }

// await main();

/**
 * @typedef {Object} Pipeline
 * @property {Step[]} steps
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
 * @property {boolean} [skipEverything]
 * @property {boolean} [skipBuilds]
 * @property {boolean} [forceBuilds]
 * @property {boolean} [skipTests]
 * @property {boolean} [canary]
 * @property {Profile[]} [buildProfiles]
 * @property {Platform[]} [buildPlatforms]
 * @property {Platform[]} [testPlatforms]
 * @property {string[]} [testFiles]
 * @property {boolean} [buildImages]
 * @property {boolean} [publishImages]
 */

/**
 * @returns {BlockStep}
 */
function getOptionsStep() {
  const booleanOptions = [
    {
      label: `${getEmoji("yes")} Yes`,
      value: "true",
    },
    {
      label: `${getEmoji("no")} No`,
      value: "false",
    },
  ];

  return {
    key: "options",
    block: getBuildkiteEmoji("gear"),
    prompt: "Customize the build options",
    blocked_state: "running",
    fields: [
      {
        key: "skip-builds",
        select: "Do you want to skip the build?",
        hint: "If true, artifacts will be downloaded from the last successful build",
        required: false,
        default: "false",
        options: booleanOptions,
      },
      {
        key: "force-builds",
        select: "Do you want to force the build?",
        hint: "If true, the build will run even if no source files have changed",
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
        key: "canary",
        select: "If building, is this a canary build?",
        hint: "If you are building for a named release, this should be false",
        required: false,
        default: "true",
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
        options: [...new Map(testPlatforms.map(platform => [getImageKey(platform), platform])).values()].map(
          platform => {
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
              value: getTargetKey(platform),
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
 * @returns {Promise<PipelineOptions>}
 */
async function getPipelineOptions() {
  const buildPlatformsMap = new Map(buildPlatforms.map(platform => [getTargetKey(platform), platform]));
  const testPlatformsMap = new Map(testPlatforms.map(platform => [getPlatformKey(platform), platform]));

  if (isBuildManual()) {
    const { fields } = getOptionsStep();
    const keys = fields?.map(({ key }) => key) ?? [];
    const values = await Promise.all(keys.map(getBuildMetadata));
    const options = Object.fromEntries(keys.map((key, index) => [key, values[index]]));

    return {
      skipBuilds: parseBoolean(options["skip-builds"]),
      forceBuilds: parseBoolean(options["force-builds"]),
      skipTests: parseBoolean(options["skip-tests"]),
      canary: parseBoolean(options["canary"]),
      buildProfiles: Array.from(options["build-profiles"] || []),
      buildPlatforms: Array.from(options["build-platforms"] || []).map(platform => buildPlatformsMap.get(platform)),
      testPlatforms: Array.from(options["test-platforms"] || []).map(platform => testPlatformsMap.get(platform)),
      testFiles: Array.from(options["test-files"] || []),
      buildImages: parseBoolean(options["build-images"]),
      publishImages: parseBoolean(options["publish-images"]),
    };
  }

  const commitMessage = getCommitMessage();
  return {
    skipEverything: /\[(skip ci|no ci)\]/i.test(commitMessage),
    skipBuilds: /\[(skip builds?|no builds?|only tests?)\]/i.test(commitMessage),
    forceBuilds: /\[(force builds?)\]/i.test(commitMessage),
    skipTests: /\[(skip tests?|no tests?|only builds?)\]/i.test(commitMessage),
    buildImages: /\[(build images?)\]/i.test(commitMessage),
    publishImages: /\[(publish images?)\]/i.test(commitMessage),
    canary:
      !parseBoolean(getEnv("RELEASE", false) || "false") &&
      !/\[(release|build release|release build)\]/i.test(commitMessage),
  };
}

/**
 * @returns {Promise<Pipeline>}
 */
async function getPipeline() {
  /** @type {Step[]} */
  const steps = [];

  if (isBuildManual() && !process.argv.includes("--apply")) {
    steps.push(getOptionsStep(), getOptionsApplyStep());
    return { steps };
  }

  const options = await getPipelineOptions();
  console.log("Pipeline options:", options);

  steps.push({
    group: "uname",
    key: "uname",
    steps: [
      {
        key: "uname-a",
        command: "uname -a",
        agents: {
          queue: "test-darwin",
        },
      },
    ],
  });

  return { steps };
}

async function main() {
  startGroup("Generating pipeline...");
  const pipeline = await getPipeline();
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
