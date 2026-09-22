#!/usr/bin/env node

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Arch, Abi as HostAbi, Os } from "../scripts/agent.ts";
import { output, run } from "../scripts/agent.ts";
import {
  type BakedImage,
  type GeneratedImage,
  bakeDirectory,
  bakeInputs,
  generateImage,
  imageKey,
  imageRecordName,
  images,
  locations,
} from "../scripts/build/ci-images/spec.ts";
import {
  getBuildMetadata,
  getCommit,
  getCommitMessage,
  getEnv,
  getJson,
  getLastSuccessfulBuild,
  getPullRequestFiles,
  getRepositoryUrl,
  getSecret,
  isBuildkite,
  isFork,
  isMainBranch,
  isMergeQueue,
  isPullRequest,
  parseGitUrl,
  startGroup,
  uploadArtifact,
} from "../scripts/buildkite.ts";
import { type ImageState, getImageState } from "../scripts/ci-image.ts";

function parseGitRepository(url: string | URL): string | undefined {
  const parsed = parseGitUrl(url);
  if (parsed) {
    const { hostname, pathname } = parsed;
    if (hostname == "github.com") {
      return pathname.slice(1);
    }
  }

  return undefined;
}

function getRepository(): string | undefined {
  const url = getRepositoryUrl();
  return url ? parseGitRepository(url) : undefined;
}

function isBuildManual(): boolean | undefined {
  if (isBuildkite) {
    const buildSource = process.env.BUILDKITE_SOURCE;
    if (buildSource) {
      const buildId = process.env.BUILDKITE_REBUILT_FROM_BUILD_ID;
      return buildSource === "ui" && !buildId;
    }
  }

  return undefined;
}

function parseBoolean(value = ""): boolean | undefined {
  if (/^(true|yes|1|on)$/i.test(value)) {
    return true;
  }
  if (/^(false|no|0|off)$/i.test(value)) {
    return false;
  }

  return undefined;
}

function setBuildMetadata(name: string, value: string): void {
  if (isBuildkite && output(["buildkite-agent", "meta-data", "set", name, value]) === undefined) {
    console.error(`Failed to set build meta-data '${name}'`);
  }
}

/** The fields of GitHub's "get the latest release" response that are read here. */
interface GithubRelease {
  tag_name: string;
}

/** The fields of GitHub's "compare two commits" response that are read here. */
interface GithubComparison {
  ahead_by?: unknown;
}

async function getCanaryRevision(): Promise<number> {
  if (isPullRequest() || isFork()) {
    return 1;
  }

  const repository = getRepository() || "oven-sh/bun";
  const { error: releaseError, body: release } = await getJson(
    new URL(`repos/${repository}/releases/latest`, getGithubApiUrl()),
  );
  if (releaseError) {
    return 1;
  }

  const commit = getCommit();
  const { tag_name: latest } = release as GithubRelease;
  const { error: compareError, body: compare } = await getJson(
    new URL(`repos/${repository}/compare/${latest}...${commit}`, getGithubApiUrl()),
  );
  if (compareError) {
    return 1;
  }

  const { ahead_by: revision } = compare as GithubComparison;
  if (typeof revision === "number") {
    return revision;
  }

  return 1;
}

function getGithubApiUrl(): URL {
  return new URL(process.env.GITHUB_API_URL || "https://api.github.com");
}

type Emoji = keyof typeof emojiMap;

const emojiMap = {
  darwin: ["🍎", "darwin"],
  linux: ["🐧", "linux"],
  debian: ["🐧", "debian"],
  ubuntu: ["🐧", "ubuntu"],
  alpine: ["🐧", "alpine"],
  aws: ["☁️", "aws"],
  amazonlinux: ["🐧", "aws"],
  nix: ["🐧", "nix"],
  windows: ["🪟", "windows"],
  true: ["✅", "white_check_mark"],
  false: ["❌", "x"],
  debug: ["🐞", "bug"],
  asan: ["🐛", "bug"],
  assert: ["🔍", "mag"],
  release: ["🏆", "trophy"],
  gear: ["⚙️", "gear"],
  clipboard: ["📋", "clipboard"],
  package: ["📦", "package"],
  rocket: ["🚀", "rocket"],
  openbsd: ["🐡", "openbsd"],
  netbsd: ["🚩", "netbsd"],
  freebsd: ["😈", "freebsd"],
};

function getEmoji(emoji: Emoji): string {
  const [unicode] = emojiMap[emoji] || [];
  return unicode || "";
}

/**
 * @link https://github.com/buildkite/emojis#emoji-reference
 */
function getBuildkiteEmoji(emoji: Emoji): string {
  const [, name] = emojiMap[emoji] || [];
  return name ? `:${name}:` : "";
}

/** A target's abi. glibc is the absence of one, so "gnu" is never spelled here. */
type Abi = Exclude<HostAbi, "gnu">;
type Distro = "debian" | "ubuntu" | "alpine" | "amazonlinux";
type Tier = "latest" | "previous" | "oldest" | "eol" | "beta";
type Profile = "release" | "assert" | "debug" | "asan";

interface Target {
  os: Os;
  arch: Arch;
  abi?: Abi | undefined;
  baseline?: boolean | undefined;
  profile?: Profile | undefined;
  /**
   * Build on a Linux host for a foreign target OS (currently: darwin and
   * windows). Agents/images resolve to the Linux build fleet; keys/labels/
   * artifacts are unaffected — these ARE the darwin/windows build lanes,
   * there is no native macOS or Windows build. FreeBSD/Android don't set
   * this — they already imply a Linux host.
   */
  crossCompile?: boolean;
}

function getTargetKey(target: Target): string {
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

function getTargetLabel(target: Target): string {
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

type Platform = Target & {
  distro?: Distro;
  release: string;
  tier?: Tier;
  features?: string[];
};

type AzureVmTier = "build" | "test";

// Azure VM sizes for Windows CI runners.
// DDSv6 = x64, DPSv6 = ARM64 (Cobalt 100). Quota: 100 cores per family in eastus2.
const azureVmSizes: Partial<Record<`${Os}-${Arch}`, Partial<Record<AzureVmTier, string>>>> = {
  // Windows builds are cross-compiled on the Linux fleet; these sizes are for
  // the steps that still need a real Windows machine (test shards, signing,
  // and the baseline-verification emulator phase).
  "windows-x64": {
    build: "Standard_D16ds_v6", // 16 vCPU, 64 GiB — verify-baseline under Intel SDE
    test: "Standard_D4ds_v6", // 4 vCPU, 16 GiB — test shards, signing
  },
  "windows-aarch64": {
    test: "Standard_D4pds_v6", // 4 vCPU, 16 GiB, local NVMe — test shards
  },
};

function getAzureVmSize(os: Os, arch: Arch, tier: AzureVmTier = "build"): string | undefined {
  return azureVmSizes[`${os}-${arch}`]?.[tier];
}

/**
 * The single host image every build lane runs on. All targets below —
 * linux x64/aarch64 × gnu/musl, darwin, windows, freebsd, android — are
 * cross-compiled from this debian-13 aarch64 box via --target/--sysroot
 * (scripts/build/config.ts + flags.ts) so one AMI serves every build.
 */
const buildHostPlatform: Platform = { os: "linux", arch: "aarch64", distro: "debian", release: "13" };

const buildPlatforms: Platform[] = [
  // macOS is cross-compiled from the debian-13 aarch64 host (clang --target +
  // the Apple SDK fetched by xmac + ld64.lld — see scripts/build/macos-sdk.ts
  // and scripts/build/flags.ts). There is no native macOS build lane: the mac
  // fleet only runs tests, against these artifacts (see testPlatforms), and
  // these are the darwin artifacts the release ships.
  { os: "darwin", arch: "aarch64", crossCompile: true, distro: "debian", release: "13" },
  { os: "darwin", arch: "x64", crossCompile: true, distro: "debian", release: "13" },
  { os: "linux", arch: "aarch64", distro: "debian", release: "13" },
  { os: "linux", arch: "x64", distro: "debian", release: "13" },
  // asan x64 cross-builds from the arm64 host too, with the amd64 compiler-rt
  // that the `crossCompilerRt` tool of scripts/build/ci-images/spec.ts installs there.
  { os: "linux", arch: "x64", profile: "asan", distro: "debian", release: "13" },
  { os: "linux", arch: "aarch64", abi: "musl", distro: "debian", release: "13" },
  { os: "linux", arch: "x64", abi: "musl", distro: "debian", release: "13" },
  // Android: cross-compiled from the debian-13 aarch64 host via NDK sysroot.
  { os: "linux", arch: "aarch64", abi: "android", distro: "debian", release: "13" },
  { os: "linux", arch: "x64", abi: "android", distro: "debian", release: "13" },
  // FreeBSD: cross-compiled from the debian-13 aarch64 host via base.txz
  // sysroot, same model as Android. Target os/arch are explicit.
  { os: "freebsd", arch: "x64", distro: "debian", release: "13" },
  { os: "freebsd", arch: "aarch64", distro: "debian", release: "13" },
  // Windows is cross-compiled from the debian-13 aarch64 host (clang-cl
  // --target + the xwin MSVC/SDK sysroot + lld-link — see
  // scripts/build/winsysroot.ts and scripts/build/flags.ts), the same model
  // as macOS above. There is no native Windows build lane: the Windows fleet
  // only runs tests, signing, and baseline verification, against these
  // artifacts (see testPlatforms), and these are the Windows artifacts the
  // release ships. x64 uses ThinLTO + cross-language LTO by default; arm64
  // stays non-LTO (no windows-arm64-lto WebKit prebuilt, see config.ts).
  { os: "windows", arch: "x64", crossCompile: true, distro: "debian", release: "13" },
  { os: "windows", arch: "aarch64", crossCompile: true, distro: "debian", release: "13" },
];

const testPlatforms: Platform[] = [
  // Darwin arm64 is targeted by `release-tier` (see getTestAgent): one job on
  // `latest` (current macOS, 26 today) and one on `previous` (anything older
  // — currently 13/14/15). x64 is NOT tier-targeted: a single entry runs on
  // whichever Intel box is free. Intel Macs can't run latest macOS and the
  // tier split bottlenecked the smaller pool, so x64 trades guaranteed
  // version coverage for throughput. The `release` field only labels the step.
  // The darwin test suite runs on real macOS agents against the Linux-built
  // artifacts from the `darwin-<arch>-build-bun` steps (the only darwin build
  // lanes — see buildPlatforms).
  // These three version-specific lanes run on main and on opt-in (see
  // darwinTestsEnabled). PR builds instead get one aarch64 lane that any mac
  // agent of that arch can take (prDarwinTestPlatforms), so the whole arm64
  // pool serves one PR lane and the whole x64 pool the other.
  { os: "darwin", arch: "aarch64", release: "26", tier: "latest" },
  { os: "darwin", arch: "aarch64", release: "14", tier: "previous" },
  { os: "darwin", arch: "x64", release: "14", tier: "latest" },
  { os: "linux", arch: "aarch64", distro: "debian", release: "13", tier: "latest" },
  { os: "linux", arch: "x64", distro: "debian", release: "13", tier: "latest" },
  { os: "linux", arch: "x64", profile: "asan", distro: "debian", release: "13", tier: "latest" },
  { os: "linux", arch: "aarch64", distro: "ubuntu", release: "25.04", tier: "latest" },
  { os: "linux", arch: "x64", distro: "ubuntu", release: "25.04", tier: "latest" },
  { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.23", tier: "latest" },
  { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.23", tier: "latest" },
  { os: "windows", arch: "x64", release: "2019", tier: "oldest" },
  { os: "windows", arch: "aarch64", release: "11", tier: "latest" },
];

function getPlatformKey(platform: Platform): string {
  const { distro, release } = platform;
  const target = getTargetKey(platform);
  const version = release.replace(/\./g, "");
  if (distro) {
    return `${target}-${distro}-${version}`;
  }
  return `${target}-${version}`;
}

/** `arch` is only printed here, and placeBinaryCheck() passes `<arch>-<abi>` as one. */
function getPlatformLabel(platform: Omit<Platform, "arch"> & { arch: string }): string {
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
 * The image of scripts/build/ci-images/spec.ts that a platform's jobs run on.
 * Cross-compiled targets (Android, FreeBSD, macOS-cross) build on a Linux
 * image, whose bake installs their sysroots: no separate image is baked.
 */
function getImage(platform: Platform): BakedImage {
  const { os, arch, distro, release, abi, crossCompile } = platform;
  const hostOs = os === "freebsd" || crossCompile ? "linux" : os;
  const image = images.find(
    image =>
      image.os === hostOs &&
      image.arch === arch &&
      image.release === release &&
      (image.os === "windows" || (image.distro === distro && image.abi === (abi === "musl" ? "musl" : "gnu"))),
  );
  if (!image) {
    throw new Error(
      `No image for ${hostOs} ${arch} ${distro ?? ""} ${release} in scripts/build/ci-images/spec.ts (images: ${images.map(imageKey).join(", ")})`,
    );
  }
  return image;
}

function getImageKey(platform: Platform): string {
  return imageKey(getImage(platform));
}

/** The platform whose jobs run on `image`: what a machine started from it is asked for with. */
function getImagePlatform(image: BakedImage): Platform {
  return image.os === "windows"
    ? { os: "windows", arch: image.arch, release: image.release }
    : {
        os: "linux",
        arch: image.arch,
        distro: image.distro,
        release: image.release,
        ...(image.abi === "musl" ? { abi: "musl" as const } : {}),
      };
}

/**
 * The step a platform's jobs wait for when this build bakes their image
 * (`baking` is the keys of the images it bakes). darwin machines are not
 * started from an image.
 */
function getImageDependsOn(platform: Platform, baking: ReadonlySet<string>): string[] {
  if (platform.os === "darwin") {
    return [];
  }
  const key = getImageKey(platform);
  return baking.has(key) ? [`${key}-image`] : [];
}

/** Tells kinds of machine apart: the baseline and profile variants of a platform run on the same one. */
function getMachineKey({ os, arch, distro, release, abi }: Platform): string {
  return [os, arch, distro, release, abi].join("-");
}

function getImageLabel(platform: Platform): string {
  const { os, arch, distro, release } = platform;
  return `${getBuildkiteEmoji(distro || os)} ${release} ${arch}`;
}

/**
 * The images of scripts/build/ci-images/spec.ts, generated: each one's bake
 * directory is written under build/ci-images/, and its name is the hash of
 * that directory.
 */
const generatedImages = new Map<BakedImage, GeneratedImage>();
function getGeneratedImage(platform: Platform): { image: BakedImage; generated: GeneratedImage } {
  const image = getImage(platform);
  let generated = generatedImages.get(image);
  if (!generated) {
    generated = generateImage(image, process.cwd());
    generatedImages.set(image, generated);
  }
  return { image, generated };
}

function getImageName(platform: Platform): string {
  return getGeneratedImage(platform).generated.name;
}

/**
 * @link https://buildkite.com/docs/pipelines/configure/retry#retry-attributes-automatic-retry-attributes
 */
function getRetry(): Retry {
  return {
    manual: {
      permit_on_passed: true,
    },
    // Self-heal agent/infra loss, and only that. Conditions within one rule
    // are ANDed, so `signal_reason` scopes each rule to the failure mode it
    // names: `none` is an agent that dropped its connection mid-job,
    // `agent_stop` is a graceful agent restart mid-job, `process_run_error`
    // is the bootstrap failing before the command ever ran. A blanket
    // `exit_status: -1` / `255` also matches `cancel`, which is what a
    // `timeout_in_minutes` kill records, so a timed-out shard would be
    // re-queued just to time out again on the next agent. User-canceled
    // builds are state=canceled and never auto-retry regardless of these
    // rules.
    automatic: [
      { exit_status: -1, signal_reason: "none", limit: 1 },
      { signal_reason: "agent_stop", limit: 2 },
      { signal_reason: "process_run_error", limit: 1 },
    ],
  };
}

/**
 * @link https://buildkite.com/docs/pipelines/managing-priorities
 */
function getPriority(): number {
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

interface Ec2Options {
  /** `undefined` when getAzureVmSize() has no size for the machine asked for. */
  instanceType: string | undefined;
}

function getEc2Agent(platform: Platform, ec2Options: Ec2Options): Ec2Agent {
  const { os, arch, abi, distro, release, crossCompile } = platform;
  const { instanceType } = ec2Options;
  // Cross-compiled targets run on a Linux EC2 box; the agent tag must match
  // the host (`linux`), not the target.
  const hostOs = os === "freebsd" || crossCompile ? "linux" : os;
  return {
    os: hostOs,
    arch,
    abi,
    distro,
    release,
    robobun: true,
    robobun2: true,
    "image-name": getImageName(platform),
    "instance-type": instanceType,
    "preemptible": false,
  };
}

function getBuildAgent(platform: Platform): Ec2Agent {
  // Every build lane runs on the single debian-13 aarch64 host image
  // (buildHostPlatform) and cross-compiles to its target; the target's
  // os/arch only affect build args, not agent tags or image-name.
  const { os, arch, abi, profile } = platform;
  // Lanes without C/C++ LTO (see ltoDefault in scripts/build/config.ts) get 32 vCPUs. That was sized when rustc ran a
  // fat LTO inside cargo beside the C++ compile (~20s lost to the overlap on 16); not re-measured since the link runs
  // the Rust LTO.
  const nonLto =
    profile === "asan" || abi === "android" || os === "freebsd" || (os === "windows" && arch === "aarch64");
  return getEc2Agent(buildHostPlatform, {
    // Replaces the c8g.4xlarge (C++) + r8g.2xlarge (cargo + ThinLTO link; r8g.4xlarge for asan) pair.
    instanceType: nonLto ? "r8g.8xlarge" : "r8g.4xlarge",
  });
}

function getTestAgent(platform: Platform): Agent {
  const { os, arch, profile, tier } = platform;

  if (os === "darwin") {
    // `release-tier` is emitted by scripts/agent.ts based on the box's macOS
    // major version. arm64 splits into `latest` (current macOS) + `previous`
    // (anything older). x64 is NOT tier-targeted — single entry, any Intel
    // box — because the tier split bottlenecked the smaller pool and Intel
    // can't run latest anyway.
    return {
      queue: tier === "beta" ? darwinBetaQueue : `test-${os}`,
      os,
      arch,
      ...(arch === "aarch64" && tier ? { "release-tier": tier } : {}),
    };
  }

  // TODO: delete this block when we upgrade to mimalloc v3
  if (os === "windows") {
    return getEc2Agent(platform, {
      instanceType: getAzureVmSize(os, arch, "test"),
    });
  }

  // musl: same vCPU as glibc but 2× RAM (m-family). The alpine images now bake
  // ~14 GB of build prefetch + ~6 GB of pre-pulled docker test images, and
  // the docker test containers (mysql/postgres on tmpfs) run alongside the
  // tests — c-family's 8 GB was the wrong side of tight.
  const musl = platform.abi === "musl";

  if (arch === "aarch64") {
    if (profile === "asan") {
      // ASAN needs ~1:8 shadow memory plus a 256 MB quarantine per process
      // plus LSan loading the binary's DWARF; the c-family's 16 GB OOMs the
      // agent. r-family has 4× the RAM at the same vCPU.
      return getEc2Agent(platform, {
        instanceType: "r8g.2xlarge",
      });
    }
    return getEc2Agent(platform, {
      instanceType: musl ? "m8g.xlarge" : "c8g.xlarge",
    });
  }

  if (profile === "asan") {
    // Same rationale as the aarch64 asan branch above.
    return getEc2Agent(platform, {
      instanceType: "r7i.2xlarge",
    });
  }
  return getEc2Agent(platform, {
    instanceType: musl ? "m7i.xlarge" : "c7i.xlarge",
  });
}

/**
 * Steps
 */

/** The `ci-<mode>` profile of scripts/build.ts a build command runs. */
type BuildMode = "build";

/**
 * Build the scripts/build.ts argument list from a target's properties.
 * Replaces the old getBuildEnv (cmake -D env vars) + getBuildCommand
 * (--target passthrough) with direct build.ts flags.
 */
function getBuildArgs(target: Target, options: PipelineOptions, mode: BuildMode): string {
  const { os, arch, abi, baseline, profile } = target;
  const { canary } = options;

  const args = [`--profile=ci-${mode}`];

  // All build lanes share a debian-13 arm64 host, so host detection cannot
  // infer the target triple — always pass os/arch (and abi on linux).
  args.push(`--os=${os}`, `--arch=${arch}`);
  if (os === "linux") args.push(`--abi=${abi ?? "gnu"}`);

  if (baseline) args.push("--baseline=on");
  if (profile === "asan") args.push("--asan=on");

  // canary: options.canary can be number (revision count) or undefined
  // (default on). Old system used CANARY_REVISION as a counter; build.ts
  // has only on/off — disabled only when explicitly 0.
  const canaryRev = typeof canary === "number" ? canary : 1;
  if (canaryRev === 0) args.push("--canary=off");

  return args.join(" ");
}

function getBuildCommand(target: Target, options: PipelineOptions, mode: BuildMode): string {
  // Windows code signing is handled by a dedicated 'windows-sign' step after
  // all Windows builds complete — see getWindowsSignStep(). smctl is x64-only,
  // so signing on the build agent wouldn't work for ARM64 anyway.
  //
  // Literal `node` — ci.ts generates a pipeline that runs on a
  // different agent later, so process.execPath (the generator's path)
  // is wrong. PATH on the agent has node: the image's bake installs it.
  return `node scripts/build.ts ${getBuildArgs(target, options, mode)}`;
}

/**
 * deps + C++ + Rust + link on one agent; also uploads libbun-*.a and the dep libs.
 */
function getBuildBunStep(platform: Platform, options: PipelineOptions): CommandStep {
  const { arch } = platform;
  // Best-effort nasm for x64 (BoringSSL win-x64, libjpeg-turbo SIMD); images bake it, and the build's own error is clearer.
  const nasmSetup =
    arch === "x64"
      ? [
          "which nasm || (apt-get update -qq && apt-get install -y -qq nasm) || dnf install -y -q nasm || yum install -y -q nasm || brew install nasm || true",
        ]
      : [];
  return {
    key: `${getTargetKey(platform)}-build-bun`,
    label: `${getTargetLabel(platform)} - build-bun`,
    agents: getBuildAgent(platform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    timeout_in_minutes: 60,
    env: {
      // ASAN runtime settings — unrelated to build config, affects the
      // linked binary's startup during the smoke test.
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0",
    },
    command: [...nasmSetup, getBuildCommand(platform, options, "build")],
  };
}

/**
 * Returns the artifact triplet for a platform, e.g. "bun-linux-aarch64" or "bun-linux-x64-musl-baseline".
 * Matches the naming convention in cmake/targets/BuildBun.cmake.
 */
function getTargetTriplet(platform: Target): string {
  const { os, arch, abi, baseline } = platform;
  let triplet = `bun-${os}-${arch}`;
  if (abi === "musl") {
    triplet += "-musl";
  }
  if (abi === "android") {
    triplet += "-android";
  }
  if (baseline) {
    triplet += "-baseline";
  }
  return triplet;
}

/**
 * Returns true if a platform needs QEMU-based baseline CPU verification.
 * x64 baseline builds verify no AVX/AVX2 instructions snuck in.
 * aarch64 builds verify no LSE/SVE instructions snuck in.
 */
function needsBaselineVerification(platform: Platform): boolean {
  const { os, arch, abi, profile } = platform;
  // asan never ships. x64-android is emulator-only; aarch64-android keeps its
  // static LSE/SVE scan via --skip-emulation in getVerifyBaselineStep().
  if (profile === "asan") return false;
  if (os === "linux") return (arch === "x64" && abi !== "android") || arch === "aarch64";
  if (os === "windows") return arch === "x64";
  return false;
}

// Ubuntu 20.04's qemu 4.2 mis-emulates concurrent atomics in same-arch user mode; after #34009
// (mimalloc per-thread heaps) the SIMD baseline test segfaults/deadlocks in `_mi_theap_init`
// ~10-20% of x64 runs and ~5% of aarch64 runs. qemu 9.1 is 40/40 green. Static-pie binaries.
const PINNED_QEMU = {
  x64: {
    url: "https://github.com/ziglang/qemu-static/releases/download/9.1.0/qemu-linux-x86_64-9.1.0.tar.xz",
    sha256: "1ac92f632417d981810fda891e4a1b20f2d71f50f9ec705532afa8162b449c70",
    binary: "qemu-linux-x86_64-9.1.0/bin/qemu-x86_64",
  },
  aarch64: {
    url: "https://github.com/ziglang/qemu-static/releases/download/9.1.0/qemu-linux-aarch64-9.1.0.tar.xz",
    sha256: "5a82a96ac74932a802fb5753673beff27359faea8736286477b0bf2c268fd06d",
    binary: "qemu-linux-aarch64-9.1.0/bin/qemu-aarch64",
  },
};

/**
 * Returns the emulator binary name for the given platform.
 * Linux uses QEMU user-mode; Windows uses Intel SDE.
 */
function getEmulatorBinary(platform: Platform): string {
  const { os, arch } = platform;
  // Intel SDE is baked into the Windows image (the `intelSde` tool of scripts/build/ci-images/spec.ts):
  // downloadmirror.intel.com sits behind a bot challenge
  // that blocks non-browser clients, so it cannot be downloaded at job time.
  if (os === "windows") return `${locations.intelSde}\\sde.exe`;
  // Fetched into the checkout root by the setup command below (see PINNED_QEMU).
  return `./${PINNED_QEMU[arch].binary}`;
}

function hasWebKitChanges(options: PipelineOptions): boolean {
  const { changedFiles = [] } = options;
  // Kept pointing at the removed SetupWebKit.cmake (always false) until
  // verify-baseline.ts's --jit-stress path is fixed: it runs wasm fixtures
  // without BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING / parsed //@ flags, so
  // fixtures using wasm-GC types (bbq-osr-with-exceptions,
  // omg-tail-call-clobber-scratch-register) fail to parse under it.
  return changedFiles.some(file => file.includes("SetupWebKit.cmake"));
}

/**
 * Host platform the verify-baseline step runs on — per-TARGET-arch, not the
 * shared arm64 build host. Reuses test-fleet images (debian-13 / win-2019) so
 * no extra bake is needed; getPipeline() keys its image depends_on on this.
 */
function getVerifyBaselineHost(platform: Platform): Platform {
  const { os, arch, abi } = platform;
  if (os === "windows") return { os: "windows", arch, release: "2019" };
  if (abi === "musl") return { os: "linux", arch, abi: "musl", distro: "alpine", release: "3.23" };
  return { os: "linux", arch, distro: "debian", release: "13" };
}

function getVerifyBaselineStep(platform: Platform, options: PipelineOptions): CommandStep {
  const { os, abi } = platform;
  const targetKey = getTargetKey(platform);
  const triplet = getTargetTriplet(platform);
  const emulator = getEmulatorBinary(platform);
  const jitStressFlag = hasWebKitChanges(options) ? " --jit-stress" : "";
  // Android binaries need /system/bin/linker64 + a bionic sysroot, neither of which exist on the
  // build host, so qemu-user cannot load them; only the static instruction scan is meaningful.
  const skipEmulationFlag = abi === "android" ? " --skip-emulation" : "";

  // Scan bun-profile, not bun. The stripped binary has no .symtab (ELF) and
  // no companion .pdb (PE) — the static scanner would emit <no-symbol@addr>
  // for everything and none of the allowlist entries would match. bun-profile
  // has identical .text so violation results are the same, just attributable.
  const profileDir = `${triplet}-profile`;
  const profileExe = os === "windows" ? "bun-profile.exe" : "bun-profile";

  const setupCommands =
    os === "windows"
      ? [
          // cmd.exe batch does not stop on error: without `|| exit /b 1` a
          // failed line is ignored and only the last command's exit code
          // becomes the step result.
          `echo Downloading build artifacts...`,
          `buildkite-agent artifact download ${profileDir}.zip . --step ${targetKey}-build-bun || exit /b 1`,
          `echo Extracting ${profileDir}.zip...`,
          `tar -xf ${profileDir}.zip || exit /b 1`,
        ]
      : [
          `buildkite-agent artifact download '${profileDir}.zip' . --step ${targetKey}-build-bun`,
          `unzip -o '${profileDir}.zip'`,
          `chmod +x ${profileDir}/${profileExe}`,
          // Linux lanes pin a known-good qemu (see PINNED_QEMU). sha256 check makes a
          // truncated/hijacked download a hard failure before anything runs under it.
          ...(abi === "android"
            ? [] // --skip-emulation: no emulator needed
            : [
                `curl -fsSL --retry 5 --connect-timeout 15 --max-time 120 -o ./qemu.tar.xz '${PINNED_QEMU[platform.arch].url}'`,
                `echo '${PINNED_QEMU[platform.arch].sha256}  ./qemu.tar.xz' | sha256sum -c -`,
                `tar -xJf ./qemu.tar.xz '${PINNED_QEMU[platform.arch].binary}'`,
              ]),
        ];

  // verify-baseline is not a build lane: it stays on a host whose arch matches
  // the TARGET so PINNED_QEMU's host-arch-specific static binaries keep working
  // (the link agent is now always arm64 and can't run the x86_64-host qemu).
  const host = getVerifyBaselineHost(platform);
  const agents =
    os === "windows"
      ? getEc2Agent(host, { instanceType: getAzureVmSize("windows", platform.arch) })
      : getEc2Agent(host, {
          instanceType: platform.arch === "aarch64" ? "r8g.2xlarge" : "r7i.2xlarge",
        });

  return {
    key: `${targetKey}-verify-baseline`,
    label: `${getTargetLabel(platform)} - verify-baseline`,
    depends_on: [`${targetKey}-build-bun`],
    agents,
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    timeout_in_minutes: hasWebKitChanges(options) ? 30 : 10,
    command: [
      ...setupCommands,
      `cargo build --release --manifest-path scripts/verify-baseline-static/Cargo.toml${os === "windows" ? " || exit /b 1" : ""}`,
      `bun scripts/verify-baseline.ts --binary ${profileDir}/${profileExe} --arch ${platform.arch} --emulator ${emulator}${skipEmulationFlag}${jitStressFlag}`,
    ],
  };
}

/**
 * The targets that link with a symbol ordering file (flags.ts `usesOrderFile`),
 * and the test machine each is traced on. No build traces its own binary: a
 * `-trace-order` step runs after the build on a machine of the target's own
 * architecture, downloads the build's `bun-profile`, traces it, and uploads the
 * `.order` artifact that later builds' `inheritOrderFile()` picks up: every
 * build, of main or of a pull request, links against the most recent one.
 *
 * The `on` platforms are entries of `testPlatforms`, so the step runs on an
 * image that exists. The windows tracer is built on the test VM for whichever
 * architecture it is running on (scripts/orderfile/functrace-windows.c), so each
 * windows target traces on its own arch's fleet.
 */
const traceOrderTargets: { os: Os; arch: Arch; on: Platform }[] = [
  { os: "darwin", arch: "aarch64", on: { os: "darwin", arch: "aarch64", release: "26", tier: "latest" } },
  { os: "linux", arch: "x64", on: { os: "linux", arch: "x64", distro: "debian", release: "13" } },
  { os: "linux", arch: "aarch64", on: { os: "linux", arch: "aarch64", distro: "debian", release: "13" } },
  { os: "windows", arch: "x64", on: { os: "windows", arch: "x64", release: "2019", tier: "oldest" } },
  { os: "windows", arch: "aarch64", on: { os: "windows", arch: "aarch64", release: "11", tier: "latest" } },
];

/**
 * Trace the symbol order file for a target on a machine of its own
 * architecture, so the next build's `inheritOrderFile()` has something to download.
 *
 * Every target is linked on the aarch64 `buildHostPlatform`, which cannot run
 * most of them. This step runs on the target-arch test fleet,
 * downloads that lane's unstripped `bun-profile`, runs it under `scripts/
 * orderfile/generate.ts` (the traced binary doubles as the interpreter), and
 * uploads the result.
 *
 * Main only: every build, of any branch or pull request, inherits from main's
 * builds, so a trace anywhere else has no consumer. Soft-fail: the order file
 * is an optimization, and a broken tracer must not fail a build.
 *
 * Windows agents run commands under cmd.exe (see getVerifyBaselineStep for the
 * `|| exit /b 1` convention). The generator compiles the tracer there, which
 * takes clang-cl or a Visual Studio environment; the image has both, and
 * vs-shell.ps1 provides the latter the same way it does for the test runner.
 * The profile zip carries the two maps the generator resolves addresses with
 * (packageAndUpload in scripts/build/ci.ts; scripts/orderfile/windows-symbols.ts).
 */
function getTraceOrderStep(target: Target, tracePlatform: Platform, options: PipelineOptions): CommandStep {
  const { os } = target;
  const targetKey = getTargetKey(target);
  const triplet = getTargetTriplet(target);
  const profileDir = `${triplet}-profile`;
  const generate = `scripts/orderfile/generate.ts --build-dir=${profileDir} --out=${triplet}.order`;
  return {
    key: `${targetKey}-trace-order`,
    label: `${getTargetLabel(target)} - trace-order`,
    depends_on: [`${targetKey}-build-bun`],
    agents: getTestAgent(tracePlatform),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    soft_fail: true,
    timeout_in_minutes: 15,
    command:
      os === "windows"
        ? [
            `buildkite-agent artifact download ${profileDir}.zip . --step ${targetKey}-build-bun || exit /b 1`,
            `tar -xf ${profileDir}.zip || exit /b 1`,
            `pwsh -NoProfile -File .\\scripts\\vs-shell.ps1 .\\${profileDir}\\bun-profile.exe ${generate} || exit /b 1`,
            `buildkite-agent artifact upload ${triplet}.order`,
          ]
        : [
            `buildkite-agent artifact download '${profileDir}.zip' . --step ${targetKey}-build-bun`,
            `unzip -o '${profileDir}.zip'`,
            `chmod +x ${profileDir}/bun-profile`,
            `./${profileDir}/bun-profile ${generate}`,
            `buildkite-agent artifact upload '${triplet}.order'`,
          ],
  };
}

interface TestOptions {
  buildId?: string | undefined;
  testFiles?: string[] | undefined;
}

function getTestBunStep(platform: Platform, options: PipelineOptions, testOptions: TestOptions = {}): CommandStep {
  const { os, profile } = platform;
  const { buildId, testFiles } = testOptions;

  const args = [`--step=${getTargetKey(platform)}-build-bun`];
  if (buildId) {
    args.push(`--build-id=${buildId}`);
  }

  if (testFiles?.length) {
    args.push(...testFiles.map(testFile => `--include=${testFile}`));
  } else {
    // platform-independent tsc check; runs in .github/workflows/bun-types.yml instead
    args.push("--exclude=integration/bun-types");
    // source-tree lints and build-script unit tests that never touch the built
    // binary; run in .github/workflows/source-lints.yml instead
    args.push("--exclude=internal/source-lints");
  }

  const depends: string[] = [];
  if (!buildId) {
    depends.push(`${getTargetKey(platform)}-build-bun`);
  }

  return {
    key: `${getPlatformKey(platform)}-test-bun`,
    label: `${getPlatformLabel(platform)} - test-bun`,
    depends_on: depends,
    agents: getTestAgent(platform),

    // No automatic retry on the beta tier: agent loss would re-queue the
    // job onto a single-box queue with nobody to take it, and a job that
    // never starts is not something soft_fail can convert.
    retry: platform.tier === "beta" ? { manual: { permit_on_passed: true }, automatic: false } : getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    // One beta box: one shard. soft_fail keeps a failing run from
    // failing the build, and the lane is never added on the merge queue
    // (see betaDarwinTestPlatforms). One window stays open: the box was
    // connected at upload but drops off during the build wait, so the
    // step sits `scheduled` with nobody to take it. That holds only this
    // PR's own build, and a cancel clears it.
    parallelism: platform.tier === "beta" ? 1 : os === "darwin" ? 2 : os === "windows" ? 8 : 20,
    ...(platform.tier === "beta" ? { soft_fail: true } : {}),
    // The beta lane runs the whole suite as one shard on one box (~35 min).
    timeout_in_minutes:
      platform.tier === "beta" ? 60 : profile === "asan" || os === "windows" || os === "darwin" ? 45 : 30,
    env: {
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0",
      // Platform smoke check: runner.node.ts asserts the agent matches what
      // this step targets before running any test (see assertExpectedPlatform).
      // `release` is only asserted where the lane pins an exact version:
      // darwin aarch64 "previous" and darwin x64 intentionally float across
      // macOS versions, and the windows "2019" label doesn't match the
      // kernel-style version the agent reports.
      EXPECTED_PLATFORM_OS: platform.os,
      EXPECTED_PLATFORM_ARCH: platform.arch,
      ...(platform.abi ? { EXPECTED_PLATFORM_ABI: platform.abi } : {}),
      ...(platform.os === "linux" && platform.distro ? { EXPECTED_PLATFORM_DISTRO: platform.distro } : {}),
      ...(platform.os === "linux" ||
      (platform.os === "darwin" && platform.arch === "aarch64" && platform.tier === "latest")
        ? { EXPECTED_PLATFORM_RELEASE: platform.release }
        : {}),
    },
    command:
      os === "windows"
        ? `pwsh -NoProfile -File .\\scripts\\vs-shell.ps1 node .\\scripts\\runner.node.ts ${args.join(" ")}`
        : os === "darwin"
          ? // The command hook installed on the tart hosts (scripts/darwin-ci/hooks/command.ts)
            // recognises a test step by this file name. runner.node.mjs only
            // imports runner.node.ts; call that directly once the hosts have a
            // hook that knows the new name.
            `./scripts/runner.node.mjs ${args.join(" ")}`
          : `./scripts/runner.node.ts ${args.join(" ")}`,
  };
}

/**
 * CI machine images
 * -----------------
 * Build and test machines boot from images baked ahead of time (AWS AMIs for
 * Linux, Azure Compute Gallery images for Windows). What is on an image is
 * described in scripts/build/ci-images/spec.ts, and an image's name is
 * `<key>-<hash>`, where the hash covers everything its bake runs.
 *
 * To change what is installed on a CI machine, edit that file. The names of
 * the images it affects change with it; a build that
 * needs a name that does not exist yet bakes it first, and every later build
 * (the PR's next push, `main` after the merge) finds it by name.
 *
 * Only builds of this repository's own branches can bake: a bake runs the
 * branch's code on a machine that becomes everyone's image.
 *
 * @returns steps for the `images` group; the last one's key is
 *   `${getImageKey(platform)}-image`, which is what dependents wait on: it has passed once the image exists.
 */
function getImageSteps(
  platform: Platform,
  image: BakedImage,
  { key, name }: GeneratedImage,
  state: ImageState,
): CommandStep[] {
  const downloadBakeDirectory = `buildkite-agent artifact download "${bakeDirectory(key)}/*" .`;
  // What the bake installed, to read from the build's page without starting a machine from the image.
  const record = `${bakeDirectory(key)}/${imageRecordName}`;
  const uploadRecord = `buildkite-agent artifact upload ${record}`;
  const bakeTimeout = 3 * 60;

  // Another build found the name missing a moment ago and is baking it.
  const waitStep: CommandStep = {
    key: `${key}-image`,
    label: `${getImageLabel(platform)} - wait-for-image`,
    agents: { queue: "build-image" },
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    command: `node ./scripts/ci-image.ts wait-image --os=${image.os} --name=${name} --timeout-minutes=${bakeTimeout - 10}`,
    timeout_in_minutes: bakeTimeout,
  };
  if (state === "pending") {
    return [waitStep];
  }

  if (image.os === "windows") {
    // Packer drives the bake on Azure from the hosted queue.
    return [
      {
        ...waitStep,
        label: `${getImageLabel(platform)} - bake-image`,
        env: {
          // Packer needs several minutes to delete its temp Azure resources after a cancel;
          // the agent's default 10s grace SIGKILLs it mid-cleanup and leaks a full
          // VM/NIC/IP stack per retry. The agent reads this from job env — there's no
          // step-level property for it.
          BUILDKITE_SIGNAL_GRACE_PERIOD_SECONDS: `${10 * 60}`,
        },
        // One command, so that a cancel reaches Packer (see bakeWindowsImage).
        command: `node ./scripts/ci-image.ts bake-image --key=${key} --name=${name} --timeout-minutes=${bakeTimeout - 10}`,
      },
    ];
  }

  // A Linux image bakes ON a fresh machine of its base image, requested with
  // the `bake` agent tag: bootstrap.sh provisions it, so this step's log is
  // the bake's log, and the machine is imaged as `image-name` once the step
  // passes. The wait step after it keeps the key dependents wait on.
  const bakeStep: CommandStep = {
    key: `${key}-bake-image`,
    label: `${getImageLabel(platform)} - bake-image`,
    agents: {
      ...getEc2Agent(platform, { instanceType: image.arch === "aarch64" ? "t4g.large" : "t3.large" }),
      "bake": true,
      "base-image": image.base.name,
      "base-image-owner": image.base.owner,
    },
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    // ($$ is a literal $ after pipeline-upload interpolation.)
    command: [
      downloadBakeDirectory,
      `$$([ "$$(id -u)" = 0 ] || echo sudo -n) sh ${bakeDirectory(key)}/bootstrap.sh "$$BUILDKITE_COMMIT" ${name}`,
      `cp ${locations.imageRecord.linux} ${record}`,
      uploadRecord,
    ],
    timeout_in_minutes: bakeTimeout,
  };
  return [bakeStep, { ...waitStep, depends_on: [bakeStep.key] }];
}

const windowsSignPlatform: Platform = { os: "windows", arch: "x64", release: "2019" };

/**
 * Batch-signs all Windows artifacts on an x64 agent (`windowsSignPlatform`).
 * DigiCert smctl is x64-only and silently fails under ARM64 emulation, so
 * signing must happen here instead of inline during each build. Re-uploads
 * signed zips with the same names so the release step picks them up
 * transparently.
 */
function getWindowsSignStep(windowsPlatforms: Platform[], options: PipelineOptions): CommandStep {
  // Each build-bun step produces two zips: <triplet>-profile.zip and <triplet>.zip
  const artifacts: string[] = [];
  const buildSteps: string[] = [];
  for (const platform of windowsPlatforms) {
    const triplet = getTargetTriplet(platform);
    const stepKey = `${getTargetKey(platform)}-build-bun`;
    artifacts.push(`${triplet}-profile.zip`, `${triplet}.zip`);
    buildSteps.push(stepKey, stepKey);
  }

  // The build platforms themselves are cross-compiled on Linux, so the agent
  // here is explicitly a native Windows box.
  return {
    key: "windows-sign",
    label: `${getBuildkiteEmoji("windows")} sign`,
    depends_on: windowsPlatforms.map(p => `${getTargetKey(p)}-build-bun`),
    agents: getEc2Agent(windowsSignPlatform, {
      instanceType: getAzureVmSize("windows", "x64", "test"),
    }),
    retry: getRetry(),
    cancel_on_build_failing: isMergeQueue(),
    command: [
      `powershell -NoProfile -ExecutionPolicy Bypass -File .buildkite/scripts/sign-windows-artifacts.ps1 ` +
        `-Artifacts ${artifacts.join(",")} ` +
        `-BuildSteps ${buildSteps.join(",")}`,
    ],
  };
}

/**
 * Aggregates stripped-binary sizes from every release build, compares them
 * against the latest main build's binary-sizes.json, and fails if any grew
 * past the threshold. Runs on PR builds (comparison) and main (record-only,
 * to produce the baseline artifact).
 */
function getBinarySizeStep(
  releasePlatforms: Platform[],
  options: PipelineOptions,
  { recordOnly = false, imageDependsOn }: { recordOnly?: boolean; imageDependsOn: string[] },
): CommandStep {
  const targets = releasePlatforms.map(p => ({ triplet: getTargetTriplet(p) }));
  const args = [`--targets '${JSON.stringify(targets)}'`, `--threshold-mb ${BINARY_SIZE_THRESHOLD_MB}`];
  if (recordOnly) args.push("--no-fail");
  if (!options.canary) args.push("--release");

  return {
    key: "binary-size",
    label: `${getBuildkiteEmoji("package")} binary-size`,
    agents: getEc2Agent(buildHostPlatform, { instanceType: "c8g.large" }),
    depends_on: [...imageDependsOn, ...releasePlatforms.map(p => `${getTargetKey(p)}-build-bun`)],
    // Sizes are still reported for the targets that built when one did not.
    // Not when this build bakes the image this step's machine starts from: a
    // failed bake would leave it waiting for a machine that cannot start.
    allow_dependency_failure: imageDependsOn.length === 0,
    soft_fail: !!options.skipSizeCheck,
    retry: {
      manual: { permit_on_passed: true },
      automatic: [{ exit_status: "*", limit: 2 }],
    },
    cancel_on_build_failing: isMergeQueue(),
    command: `bun scripts/binary-size.ts ${args.join(" ")}`,
  };
}

const BINARY_SIZE_THRESHOLD_MB = 0.5;

function getReleaseStep(
  releasePlatforms: Platform[],
  options: PipelineOptions,
  { signed = false, testStepKeys = [] }: { signed?: OptionFlag; testStepKeys?: string[] } = {},
): CommandStep {
  const { canary } = options;
  const revision = typeof canary === "number" ? canary : 1;

  // When signing ran, depend on windows-sign instead of the raw Windows builds
  // so we wait for signed artifacts before releasing.
  const depends_on = signed
    ? [...releasePlatforms.filter(p => p.os !== "windows").map(p => `${getTargetKey(p)}-build-bun`), "windows-sign"]
    : releasePlatforms.map(platform => `${getTargetKey(platform)}-build-bun`);

  // Gate canary upload on green tests. A red test lane leaves the artifacts in
  // Buildkite but skips the GitHub/S3 upload; the next green main push ships.
  // [skip tests] on main still lets the release run (testStepKeys is empty).
  depends_on.push(...testStepKeys);

  return {
    key: "release",
    label: getBuildkiteEmoji("rocket"),
    agents: getEc2Agent(buildHostPlatform, { instanceType: "c8g.large" }),
    depends_on,
    env: {
      CANARY: revision,
      // Tells upload-release.sh to fetch Windows zips from the sign step
      // (same filenames, but the signed re-uploads are the ones we want).
      WINDOWS_ARTIFACT_STEP: signed ? "windows-sign" : "",
    },
    command: ".buildkite/scripts/upload-release.sh",
  };
}

interface Pipeline {
  steps?: Step[];
  priority?: number;
}

/**
 * The agent tags a step targets. JSON.stringify() drops the `undefined` ones.
 */
type Agent = Ec2Agent | QueueAgent;

/** A machine created for the job from `image-name` and `instance-type`. */
interface Ec2Agent {
  os: Os;
  arch: Arch;
  abi: Abi | undefined;
  distro: Distro | undefined;
  release: string;
  robobun: boolean;
  robobun2: boolean;
  "image-name": string;
  "instance-type": string | undefined;
  preemptible: boolean;
  /**
   * Image the machine as `image-name` once the step passes (see
   * getImageSteps), starting it from `base-image`, an exact image name of the
   * account `base-image-owner`.
   */
  bake?: boolean;
  "base-image"?: string;
  "base-image-owner"?: string;
}

/** A standing agent: the hosted queues, and the bare-metal darwin test fleet. */
interface QueueAgent {
  queue: string | undefined;
  os?: Os;
  arch?: Arch;
  "release-tier"?: Tier;
}

/**
 * @link https://buildkite.com/docs/pipelines/configure/retry
 */
interface Retry {
  manual: { permit_on_passed: boolean };
  automatic: AutomaticRetry[] | false;
}

interface AutomaticRetry {
  exit_status?: number | "*";
  signal_reason?: "none" | "agent_stop" | "process_run_error";
  limit: number;
}

type Step = GroupStep | CommandStep | BlockStep;

interface GroupStep {
  key: string;
  group: string;
  steps: CommandStep[];
  depends_on?: string[];
}

/**
 * @link https://buildkite.com/docs/pipelines/command-step
 */
interface CommandStep {
  key: string;
  label?: string;
  agents?: Agent;
  env?: Record<string, string | number>;
  command: string | string[];
  depends_on?: string[];
  allow_dependency_failure?: boolean;
  retry?: Retry;
  cancel_on_build_failing?: boolean;
  soft_fail?: boolean;
  parallelism?: number;
  timeout_in_minutes?: number;
}

interface BlockStep {
  key: string;
  block: string;
  blocked_state?: "passed" | "failed" | "running";
  fields?: (SelectInput | TextInput)[];
}

interface TextInput {
  key: string;
  text: string;
  required?: boolean;
  hint?: string;
}

interface SelectInput {
  key: string;
  select: string;
  default?: string | string[];
  required?: boolean;
  multiple?: boolean;
  hint?: string;
  options?: SelectOption[];
}

interface SelectOption {
  label: string;
  value: string;
}

/**
 * An on/off option. From a commit subject it is the text of the `[tag]` that
 * turned it on, or `false`; from the options step of a manual build it is what
 * parseBoolean() made of the answer.
 */
type OptionFlag = string | boolean | undefined;

interface PipelineOptions {
  skipEverything?: OptionFlag;
  skipBuilds?: OptionFlag;
  skipTests?: OptionFlag;
  skipSizeCheck?: OptionFlag;
  forceBuilds?: OptionFlag;
  signWindows?: OptionFlag;
  dryRun?: OptionFlag;
  canary?: number;
  buildPlatforms?: Platform[];
  testPlatforms?: Platform[];
  testFiles?: string[] | undefined;
  changedFiles?: string[];
}

function getStepWithDependsOn<T extends GroupStep | CommandStep>(step: T, ...dependsOn: (string | undefined)[]): T {
  const { depends_on: existingDependsOn = [] } = step;
  return {
    ...step,
    depends_on: [...existingDependsOn, ...dependsOn.filter((key): key is string => Boolean(key))],
  };
}

function getOptionsStep(): BlockStep {
  const booleanOptions: SelectOption[] = [
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
            label: `${getEmoji("asan")} Release with ASAN`,
            value: "asan",
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
        // One option per distinct image — the baseline/profile variants collapse
        // into the first (plain) entry since profiles come from `build-profiles`.
        // The option value must be that entry's *platform* key: it's what
        // getPipelineOptions() resolves through testPlatformsMap, and the image
        // key isn't a platform key.
        options: testPlatforms
          .filter(
            (platform, index, array) => index === array.findIndex(p => getMachineKey(p) === getMachineKey(platform)),
          )
          .map(platform => {
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
              value: getPlatformKey(platform),
            };
          }),
      },
      {
        key: "test-files",
        text: "If testing, which files do you want to test?",
        hint: "If specified, only run test paths that include the list of strings (e.g. 'test/js', 'test/cli/hot/watch.ts')",
        required: false,
      },
    ],
  };
}

function getOptionsApplyStep(): CommandStep {
  const command = getEnv("BUILDKITE_COMMAND");
  return {
    key: "options-apply",
    label: getBuildkiteEmoji("gear"),
    command: `${command} --apply`,
    depends_on: ["options"],
    agents: {
      queue: process.env.BUILDKITE_AGENT_META_DATA_QUEUE,
    },
  };
}

/**
 * The platform behind a key picked in a manual build's options step. The step
 * offers every build platform, but main does not build asan, so a picked key
 * can be one this build does not have.
 */
function getSelectedPlatform(platforms: Map<string, Platform>, key: string): Platform {
  const platform = platforms.get(key);
  if (!platform) {
    throw new Error(
      `Platform "${key}" is not available in this build (available: ${[...platforms.keys()].join(", ")})`,
    );
  }
  return platform;
}

async function getPipelineOptions(): Promise<PipelineOptions | undefined> {
  const isManual = isBuildManual();
  if (isManual && !process.argv.includes("--apply")) {
    return;
  }

  let filteredBuildPlatforms = buildPlatforms;
  if (isMainBranch()) {
    filteredBuildPlatforms = buildPlatforms.filter(({ profile }) => profile !== "asan");
  }

  const canary = await getCanaryRevision();
  const buildPlatformsMap = new Map(filteredBuildPlatforms.map(platform => [getTargetKey(platform), platform]));
  const testPlatformsMap = new Map(testPlatforms.map(platform => [getPlatformKey(platform), platform]));

  if (isManual) {
    const { fields } = getOptionsStep();
    const keys = fields?.map(({ key }) => key) ?? [];
    const values = keys.map(getBuildMetadata);
    const options = Object.fromEntries(keys.map((key, index) => [key, values[index]]));

    const parseArray = (value: string | undefined): string[] | undefined =>
      value
        ?.split("\n")
        ?.map(item => item.trim())
        ?.filter(Boolean);

    // The answers to the options step, as Buildkite stored them. The values of
    // "build-profiles" are that field's options. They are only needed for the
    // platforms that were picked.
    const getBuildProfiles = (): Profile[] => {
      const buildProfiles = parseArray(options["build-profiles"]) as Profile[] | undefined;
      if (buildProfiles === undefined) {
        throw new Error("Platforms were picked in the options step, but it has no build-profiles");
      }
      return buildProfiles;
    };
    const buildPlatformKeys = parseArray(options["build-platforms"]);
    const testPlatformKeys = parseArray(options["test-platforms"]);
    return {
      canary: parseBoolean(options.canary) ? canary : 0,
      skipBuilds: parseBoolean(options["skip-builds"]),
      forceBuilds: parseBoolean(options["force-builds"]),
      skipTests: parseBoolean(options["skip-tests"]),
      testFiles: parseArray(options["test-files"]),
      buildPlatforms: buildPlatformKeys?.length
        ? buildPlatformKeys.flatMap(key =>
            getBuildProfiles().map(profile => ({ ...getSelectedPlatform(buildPlatformsMap, key), profile })),
          )
        : Array.from(buildPlatformsMap.values()),
      testPlatforms: testPlatformKeys?.length
        ? testPlatformKeys.flatMap(key =>
            getBuildProfiles().map(profile => ({ ...getSelectedPlatform(testPlatformsMap, key), profile })),
          )
        : Array.from(testPlatformsMap.values()),
      dryRun: parseBoolean(options["dry-run"]),
    };
  }

  // BUILDKITE_MESSAGE is the commit subject line only — option tags like
  // [skip tests] must appear in the subject, not the commit body.
  const commitMessage = getCommitMessage();
  if (commitMessage === undefined) {
    throw new Error("Failed to read the commit message");
  }

  const parseOption = (pattern: RegExp): OptionFlag => {
    const match = pattern.exec(commitMessage);
    if (match) {
      const [, value] = match;
      return value;
    }
    return false;
  };

  const isCanary =
    !parseBoolean(process.env.RELEASE || "false") && !/\[(release|build release|release build)\]/i.test(commitMessage);

  return {
    canary: isCanary ? canary : 0,
    skipEverything: parseOption(/\[(skip ci|no ci)\]/i),
    skipBuilds: parseOption(/\[(skip builds?|no builds?|only tests?)\]/i),
    forceBuilds: parseOption(/\[(force builds?)\]/i),
    skipTests: parseOption(/\[(skip tests?|no tests?|only builds?)\]/i),
    skipSizeCheck: parseOption(/\[(skip size( check)?|allow size)\]/i),
    signWindows: parseOption(/\[(sign windows)\]/i),
    dryRun: parseOption(/\[(dry run)\]/i),
    buildPlatforms: Array.from(buildPlatformsMap.values()),
    testPlatforms: Array.from(testPlatformsMap.values()),
  };
}

/** The fields of Buildkite's "list agents" response that are read here. */
interface BuildkiteAgent {
  connection_state: string;
  meta_data?: string[];
}

/** The fields of Buildkite's "list builds" response that are read here. */
interface BuildkiteBuildJobs {
  jobs?: { state: string; agent_query_rules?: string[] }[];
}

/**
 * True when the darwin beta queue can take one more job right now: an
 * agent is connected to it, and no live build has a job targeting it in
 * any non-terminal state (`waiting` counts: the beta test step waits on
 * the darwin build for tens of minutes before it is ever `scheduled`).
 * Reads the cluster secret `CI_QUEUE_PROBE_TOKEN` (a REST token with
 * read_builds and read_agents only); without it, or on any error, the
 * answer is false and the lane is simply not added. Two uploads a few
 * seconds apart can both see "idle"; a queue of two is the worst case.
 */
async function darwinBetaQueueIdle(): Promise<boolean> {
  if (!isBuildkite) {
    return false;
  }
  try {
    // getSecret throws on Buildkite when the secret is absent; the probe
    // must never take the pipeline down with it.
    const token = getSecret("CI_QUEUE_PROBE_TOKEN", { required: false });
    if (!token) {
      return false;
    }
    const api = async (path: string): Promise<Response | undefined> => {
      const res = await fetch(`https://api.buildkite.com/v2/organizations/bun/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? res : undefined;
    };

    // No connected agent: a step added now would sit `scheduled` until
    // the box comes back, and soft_fail does nothing for a job that
    // never starts. The org has a few hundred agents and the list pages
    // at 100, so follow `Link: rel="next"`; `stopping` does not count.
    let connected = false;
    let next: string | undefined = "agents?per_page=100";
    for (let page = 0; next && page < 10 && !connected; page++) {
      const res = await api(next);
      if (!res) {
        return false;
      }
      const agents = (await res.json()) as BuildkiteAgent[];
      connected = agents.some(
        ({ connection_state, meta_data = [] }) =>
          connection_state === "connected" && meta_data.includes(`queue=${darwinBetaQueue}`),
      );
      const link = res.headers.get("link") ?? "";
      const match = link.match(/<https:\/\/api\.buildkite\.com\/v2\/organizations\/bun\/([^>]+)>;\s*rel="next"/);
      next = match?.[1];
    }
    if (!connected) {
      return false;
    }

    // Builds in `failing` and `canceling` still carry live jobs.
    const res = await api(
      "pipelines/bun/builds?state%5B%5D=running&state%5B%5D=scheduled&state%5B%5D=failing&state%5B%5D=canceling&per_page=100",
    );
    if (!res) {
      return false;
    }
    const builds = (await res.json()) as BuildkiteBuildJobs[];
    const terminal = new Set([
      "passed",
      "failed",
      "canceled",
      "skipped",
      "timed_out",
      "expired",
      "broken",
      "finished",
      "waiting_failed",
      "blocked_failed",
      "unblocked_failed",
    ]);
    const busy = builds.some(({ jobs = [] }) =>
      jobs.some(
        ({ state, agent_query_rules = [] }) =>
          !terminal.has(state) && agent_query_rules.includes(`queue=${darwinBetaQueue}`),
      ),
    );
    return !busy;
  } catch {
    return false;
  }
}

const darwinBetaQueue = "test-darwin-beta";

async function getPipeline(options: PipelineOptions = {}): Promise<Pipeline | undefined> {
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

  const { buildPlatforms = [], testPlatforms = [] } = options;
  // Sign with [sign windows] in the commit message (for testing the sign step
  // on a branch). DigiCert charges per signature, so canary builds are never signed.
  const windowsPlatforms = buildPlatforms.filter(p => p.os === "windows");
  const signWindows = ((isMainBranch() && !options.canary) || !!options.signWindows) && windowsPlatforms.length > 0;

  // A build makes sure every image of the spec exists, not only the ones its
  // own steps start from: which steps a build has depends on its options (a
  // manual build can pick platforms; verify-baseline, signing and symbol-order
  // steps each choose their own machine), and an image only exists once some
  // build has baked it. Whether one exists can only be asked in CI, where the
  // cloud credentials are.
  //
  // A fork's build does not ask: it cannot bake, so it would learn nothing it
  // can act on, and asking takes the cloud's credentials, which a job that
  // runs a fork's code has no reason to read. Unless the fork changes what a
  // bake runs, its images are ones this repository's builds already baked.
  const changedBakeInputs = options.changedFiles?.filter(file => bakeInputs.includes(file)) ?? [];
  if (isFork() && changedBakeInputs.length) {
    throw new Error(
      `This pull request changes what CI's images are baked from (${changedBakeInputs.join(", ")}), and a fork's build cannot bake: a bake runs the branch's code on a machine that becomes everyone's image. Push the branch to oven-sh/bun to bake them.`,
    );
  }
  const baking = new Set<string>();
  const imageSteps: CommandStep[] = [];
  for (const platform of isBuildkite && !isFork() ? images.map(getImagePlatform) : []) {
    const key = getImageKey(platform);
    const { image, generated } = getGeneratedImage(platform);
    const state = await getImageState(image.os, generated.name);
    console.log(` - ${generated.name}: ${state}`);
    if (state === "available") {
      continue;
    }
    if (state !== "pending") {
      await run(["buildkite-agent", "artifact", "upload", `${bakeDirectory(key)}/*`]);
    }
    baking.add(key);
    imageSteps.push(...getImageSteps(platform, image, generated, state));
  }

  const steps: Step[] = [];

  if (imageSteps.length) {
    steps.push({ key: "images", group: getBuildkiteEmoji("aws"), steps: imageSteps });
  }

  const { skipBuilds, forceBuilds, dryRun } = options;

  let buildId: string | undefined;
  if (skipBuilds && !forceBuilds) {
    const lastBuild = await getLastSuccessfulBuild();
    if (lastBuild) {
      const { id } = lastBuild;
      buildId = id;
    } else {
      console.warn("No last successful build found, must force builds...");
    }
  }

  const includeASAN = !isMainBranch();

  // verify-baseline / trace-order: checks that run on a built binary on a
  // test-fleet host. They are drawn in that host's test group (or a
  // lane-style group of their own when the target has no test lane, e.g.
  // android) rather than in
  // the build group — Buildkite's canvas draws every edge into a group as
  // leaving after the whole group, so nesting them with build-bun made
  // test-bun look like it waited on them — and rather than top-level, where
  // a step still waiting on its depends_on renders greyed out like a skipped
  // one. Emitted after the test groups so the same-label merge below folds
  // them into the test group and that group keeps its own depends_on.
  // Scheduling is by step key either way: each depends on <target>-build-bun.
  const binaryCheckSteps: Step[] = [];
  /**
   * The group a binary check is drawn in: the host's test group when the
   * target has a test lane there (returned via binaryCheckSteps, emitted after
   * the test groups), else a lane-style group of its own for that target on
   * that host — `<host distro> <release> <arch>-<abi>` — returned for the
   * caller to emit next to the build group.
   */
  const placeBinaryCheck = (target: Target, host: Platform, step: CommandStep): Step[] => {
    const inTestLane = testPlatforms.some(
      p => getPlatformKey(p) === getPlatformKey(host) && (p.abi ?? null) === (target.abi ?? null),
    );
    if (inTestLane) {
      binaryCheckSteps.push({ key: getPlatformKey(host), group: getPlatformLabel(host), steps: [step] });
      return [];
    }
    const lane = { ...host, abi: target.abi, baseline: target.baseline, profile: target.profile };
    return [
      {
        key: getPlatformKey(lane),
        group: getPlatformLabel({ ...lane, arch: target.abi ? `${lane.arch}-${target.abi}` : lane.arch }),
        steps: [step],
      },
    ];
  };

  if (!buildId) {
    let relevantBuildPlatforms = includeASAN
      ? buildPlatforms
      : buildPlatforms.filter(({ profile }) => profile !== "asan");

    steps.push(
      ...relevantBuildPlatforms.flatMap(target => {
        // build-bun always runs on buildHostPlatform regardless of
        // target, so the only image dependency is the host's.
        const dependsOn = getImageDependsOn(buildHostPlatform, baking);

        const steps: Step[] = [
          getStepWithDependsOn(
            {
              key: getTargetKey(target),
              group: getTargetLabel(target),
              steps: [getBuildBunStep(target, options)],
            },
            ...dependsOn,
          ),
        ];

        if (needsBaselineVerification(target)) {
          // verify-baseline runs on a per-target-arch native host (see
          // getVerifyBaselineHost), not buildHostPlatform.
          const verifyHost = getVerifyBaselineHost(target);
          const verifyDeps = getImageDependsOn(verifyHost, baking);
          steps.push(
            ...placeBinaryCheck(
              target,
              verifyHost,
              getStepWithDependsOn(getVerifyBaselineStep(target, options), ...verifyDeps),
            ),
          );
        }

        // Trace the symbol order file later builds inherit, on the target's own
        // test fleet (see getTraceOrderStep). On main: that is where every
        // build, of a pull request too, inherits from. Release profile only —
        // usesOrderFile() is false under a sanitizer anyway.
        const traceOn = traceOrderTargets.find(
          t =>
            t.os === target.os && t.arch === target.arch && !target.abi && (target.profile ?? "release") === "release",
        );
        if (traceOn && isMainBranch()) {
          const traceDeps = getImageDependsOn(traceOn.on, baking);
          steps.push(
            ...placeBinaryCheck(
              target,
              traceOn.on,
              getStepWithDependsOn(getTraceOrderStep(target, traceOn.on, options), ...traceDeps),
            ),
          );
        }

        return steps;
      }),
    );
  }

  // Tests run on main too so the canary release step below can gate on them.
  // ASAN is PR-only (see includeASAN above), so the asan test lane is dropped
  // on main along with its build.
  // Untiered: any arm64 mac agent, whatever macOS it runs, can take it.
  const prDarwinTestPlatforms: Platform[] = [
    { os: "darwin", arch: "aarch64", release: "any" },
    { os: "darwin", arch: "x64", release: "any" },
  ];
  const darwinTestsEnabled =
    isMainBranch() || isBuildManual() || /\[(macos|darwin) tests?\]/i.test(getCommitMessage() ?? "");
  // The macOS beta lane: a single home-hosted mini on the next macOS,
  // its own queue, soft-fail. PR builds get it only when that queue is
  // idle at upload time, so it is always busy while PRs flow and never
  // has a backlog: a PR that misses it loses nothing.
  // Never on the merge queue: a step that cannot start (box offline) would
  // hold the required check open and stall the queue.
  const betaDarwinTestPlatforms: Platform[] =
    !darwinTestsEnabled && !isMergeQueue() && (await darwinBetaQueueIdle())
      ? [{ os: "darwin", arch: "aarch64", release: "27", tier: "beta" }]
      : [];
  const relevantTestPlatforms = (
    includeASAN ? testPlatforms : testPlatforms.filter(({ profile }) => profile !== "asan")
  )
    .filter(({ os }) => os !== "darwin" || darwinTestsEnabled)
    .concat(darwinTestsEnabled ? [] : prDarwinTestPlatforms)
    .concat(darwinTestsEnabled ? [] : betaDarwinTestPlatforms);
  const testStepKeys: string[] = [];
  {
    const { skipTests, testFiles } = options;
    if (!skipTests) {
      steps.push(
        ...relevantTestPlatforms.map(target => {
          const step = getTestBunStep(target, options, { testFiles, buildId });
          testStepKeys.push(step.key);
          // Test shards run on their native platform image; when this build
          // bakes it, they wait for it.
          const dependsOn = getImageDependsOn(target, baking);
          return getStepWithDependsOn(
            {
              key: getPlatformKey(target),
              group: getPlatformLabel(target),
              steps: [step],
            },
            ...dependsOn,
          );
        }),
      );
    }
  }

  steps.push(...binaryCheckSteps);

  // Binary-size tracking: main records the baseline, PRs enforce the threshold.
  const strippedPlatforms = buildPlatforms.filter(p => (p.profile ?? "release") === "release");
  if (!buildId && strippedPlatforms.length) {
    steps.push(
      getBinarySizeStep(strippedPlatforms, options, {
        recordOnly: isMainBranch(),
        imageDependsOn: getImageDependsOn(buildHostPlatform, baking),
      }),
    );
  }

  if (signWindows) {
    steps.push(
      getStepWithDependsOn(
        getWindowsSignStep(windowsPlatforms, options),
        ...getImageDependsOn(windowsSignPlatform, baking),
      ),
    );
  }

  if (isMainBranch()) {
    steps.push(getReleaseStep(buildPlatforms, options, { signed: signWindows, testStepKeys }));
  }

  // Merge same-label groups into their first occurrence, keeping every
  // step's position so the sidebar reads in pipeline order.
  const stepsByGroup = new Map<string, GroupStep>();
  const mergedSteps: Step[] = [];
  for (const step of steps) {
    if (!("group" in step)) {
      mergedSteps.push(step);
      continue;
    }
    const existing = stepsByGroup.get(step.group);
    if (existing) {
      existing.steps.push(...step.steps);
    } else {
      stepsByGroup.set(step.group, step);
      mergedSteps.push(step);
    }
  }

  return { priority, steps: mergedSteps };
}

async function main() {
  startGroup("Generating options...");
  const options = await getPipelineOptions();
  if (options) {
    console.log("Generated options:", options);
  }

  startGroup("Querying GitHub for files...");
  if (options && isBuildkite && !isMainBranch()) {
    let allFiles: string[] = [];
    let newFiles: string[] = [];
    try {
      ({ allFiles, newFiles } = await getPullRequestFiles());
    } catch (e) {
      console.error(e);
    }
    if (allFiles.length > 0 && allFiles.every(filename => filename.startsWith("docs/"))) {
      console.log(`- PR is only docs, skipping tests!`);
      return;
    }
    options.changedFiles = allFiles;
    // Publish the file lists as build meta-data so each test shard can read
    // them instead of re-querying GitHub. With ~150 shards per build, this
    // is the difference between 1 API call and 150, and the per-shard calls
    // were exhausting the token's hourly rate limit under load.
    if (allFiles.length > 0) {
      setBuildMetadata("pr-all-files", JSON.stringify(allFiles));
      setBuildMetadata("pr-new-files", JSON.stringify(newFiles));
    }
  }

  startGroup("Generating pipeline...");
  const pipeline = await getPipeline(options);
  if (!pipeline) {
    console.log("Generated pipeline is empty, skipping...");
    return;
  }

  // JSON is YAML, which is what `buildkite-agent pipeline upload` parses every file as.
  const content = JSON.stringify(pipeline, null, 2);
  const contentPath = join(process.cwd(), ".buildkite", "ci.json");
  writeFileSync(contentPath, content);

  console.log("Generated pipeline:");
  console.log(" - Path:", contentPath);
  console.log(" - Size:", (content.length / 1024).toFixed(), "KB");

  if (isBuildkite) {
    startGroup("Uploading pipeline...");
    try {
      await run(["buildkite-agent", "pipeline", "upload", contentPath]);
    } finally {
      await uploadArtifact(contentPath);
    }
  }
}

await main();
