// Types for the CI image spec (./spec.ts).
//
// The types are the checklist: LinuxBuildHostImage requires the cross
// toolchains that LinuxTestImage may not have; WindowsX64Image requires the
// Intel SDE + x64-only Scoop packages that WindowsArm64Image may not have.
// A field that only some images bake exists only on those images' types.
//
// Types only (erased at runtime, zero cost under node type-stripping).
// Import with `import type`.

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

export type Arch = "x64" | "aarch64";

export type NodejsSpec = {
  readonly version: string;
  /** node-gyp reads `installVersion` from its header cache; the value it
   * expects for these headers. */
  readonly gypInstallVersion: string;
  readonly distBase: string;
  /** nodejs.org publishes no musl builds; the unofficial-builds project
   * ships x64-musl and arm64-musl. */
  readonly muslDistBase: string;
  readonly headersDistBase: string;
};

export type BunSpec = {
  /** The bun release that runs the bake's own tooling (prefetch-deps,
   * xmac.mjs, install-cache warm-up). Not the bun under test. */
  readonly version: string;
  readonly releaseBase: string;
};

export type LlvmSpec = {
  readonly version: string;
  readonly major: number;
  /** apt.llvm.org's llvm.sh installs `major` from their repository
   * (FLOATING: serves the current point release, currently `version`). */
  readonly aptScriptUrl: string;
};

export type PinnedRelease = {
  readonly version: string;
  readonly releaseBase: string;
};

export type AgeSpec = {
  readonly version: string;
  readonly releaseBase: string;
  /** Pinned checksums per asset (`${os}-${cpu}`). */
  readonly sha256: { readonly [asset: string]: string };
};

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

export type LinuxDistro = "debian" | "ubuntu" | "alpine";
export type LinuxAbi = "gnu" | "musl";

/** Distro packages installed via the image's package manager.
 * FLOATING: OS repositories serve whatever versions are current. */
export type LinuxPackages = {
  readonly manager: "apt" | "apk";
  readonly common: readonly string[];
  readonly buildEssentials: readonly string[];
  readonly chromium: readonly string[];
  /** QEMU user-mode packages for baseline CPU verification. */
  readonly qemu: readonly string[];
  /** Packages providing this LLVM major (apk only; apt uses llvm.sh). */
  readonly llvm: readonly string[];
};

export type LinuxRustSpec = {
  readonly home: string;
  /** FLOATING: the rustup installer and the toolchain it selects. The
   * build pins its own toolchain via rust-toolchain.toml; the image seeds a
   * default plus the cross targets so first builds don't hit the network. */
  readonly rustupUrl: string;
  readonly targets: readonly string[];
  readonly components: readonly string[];
};

/** Cross-compilation toolchains + sysroots. Only the build host image
 * carries these (it cross-compiles every target). */
export type CrossToolchains = {
  /** Windows SDK + MSVC CRT splat for --os=windows cross-compiles.
   * scripts/build/winsysroot.ts imports these same values. */
  readonly winSysroot: {
    readonly xwinVersion: string;
    readonly xwinReleaseBase: string;
    readonly sdkVersion: string;
    readonly crtVersion: string;
    readonly path: string;
  };
  /** macOS SDK for darwin cross-compiles. scripts/build/macos-sdk.ts
   * imports these same values. */
  readonly macosSdk: {
    readonly version: string;
    /** The Command Line Tools release whose package contains `version`. */
    readonly cltRelease: string;
    readonly path: string;
    /** raw.githubusercontent base the vendored xmac.mjs is fetched from
     * (per bootstrapping ref) so bake and build share the Apple-CDN path. */
    readonly xmacRawBase: string;
  };
  readonly androidNdk: {
    readonly version: string;
    readonly releaseBase: string;
    readonly path: string;
  };
  readonly freebsdSysroot: {
    readonly version: string;
    readonly releaseBase: string;
    readonly paths: { readonly amd64: string; readonly arm64: string };
  };
  /** ubuntu:20.04 (glibc 2.31) + gcc-13 libstdc++, matching the environment
   * prebuilt WebKit is compiled in. FLOATING: the ubuntu:20.04 base image
   * and its focal package versions. */
  readonly glibcSysroot: {
    readonly ubuntuImage: string;
    readonly glibcVersion: string;
    readonly paths: { readonly x86_64: string; readonly aarch64: string };
    readonly aptBase: { readonly x86_64: string; readonly aarch64: string };
    readonly dists: readonly string[];
    readonly packages: readonly string[];
    readonly gcc13ReleaseBase: string;
  };
  /** musl sysroot populated from alpine's own packages via apk.static so
   * libstdc++ matches the native alpine test image. `alpineRelease` must
   * equal the alpine images' release. FLOATING: apk package versions. */
  readonly muslSysroot: {
    readonly alpineRelease: string;
    readonly paths: { readonly x86_64: string; readonly aarch64: string };
    readonly packages: readonly string[];
    readonly cdnBase: string;
  };
  /** Cross-arch GNU strip for -R .eh_frame (host strip rejects
   * foreign-arch ELF). */
  readonly crossBinutils: readonly string[];
};

/** Fields on every linux image. */
export type LinuxImageBase = {
  readonly key: string;
  readonly os: "linux";
  readonly arch: Arch;
  readonly distro: LinuxDistro;
  readonly release: string;
  readonly abi: LinuxAbi;
  readonly cloud: "aws";
  /** FLOATING: the newest AMI matching this glob at bake time. */
  readonly base: { readonly ownerAlias: string; readonly nameGlob: string };
  /** The bake VM only runs bootstrap; runner instance types live in
   * ci.mjs. */
  readonly bake: { readonly instanceType: string; readonly diskSizeGb: number };
  readonly nodejs: NodejsSpec;
  readonly bun: BunSpec;
  readonly llvm: LlvmSpec;
  /** Kitware's self-extracting installer on apt distros; alpine uses its
   * package. */
  readonly cmake: PinnedRelease;
  readonly curlH3: PinnedRelease;
  readonly buildkiteAgent: PinnedRelease;
  readonly age: AgeSpec;
  /** python-fuse builds from source on alpine (no wheel); apt distros use
   * the python3-fuse package. */
  readonly pythonFuse: PinnedRelease;
  readonly rust: LinuxRustSpec;
  readonly packages: LinuxPackages;
  /** FLOATING installer scripts (fetched, run, unverifiable by design). */
  readonly dockerInstallUrl: string;
  readonly tailscaleInstallUrl: string;
  /** The things baked onto this image, BY COMPONENT NAME, IN INSTALL
   * ORDER (components/registry.ts resolves the names). Ordering is data:
   * this list is the sequencer's only input, and the same list is walked
   * to build the hashed download bundle. */
  readonly components: readonly string[];
  /** Every path a linux bake writes to, rooted so each is written once.
   * Components compose their locations from these roots (see
   * components/paths.ts) — no path string is restated across components. */
  readonly paths: {
    /** Where binaries land (node, bun, curl-h3, age, buildkite-agent). */
    readonly bin: string;
    /** Where /opt-style trees land (rust, ndk, sysroots, prefetch cache). */
    readonly opt: string;
    /** node include tree for headers. */
    readonly include: string;
    readonly buildkiteUser: string;
    readonly buildkiteHome: string;
    /** Filename of the bundled agent inside buildkiteHome. A single fact:
     * machine.mjs names its esbuild output this, and the service definition
     * runs it, so uploader and runner can't diverge (or fork on a rename). */
    readonly buildkiteAgentEntry: string;
    /** Extra state dirs the buildkite user owns. */
    readonly buildkiteDirs: readonly string[];
    readonly prefetchDir: string;
    readonly installCacheDir: string;
    /** Core dumps: %e = executable, %p = pid. scripts/runner.node.mjs reads
     * cores from this same directory pattern. */
    readonly coresDirPattern: string;
  };
  /** CI-only kernel/systemd/apt tuning. */
  readonly system: {
    readonly limits: readonly string[];
    /** nofile/nproc can't be "unlimited"; everything else is. */
    readonly countedLimits: { readonly [limit: string]: number };
    readonly dpkgOptions: readonly string[];
    readonly aptOptions: readonly string[];
  };
};

/** Fields that differ by CPU architecture on linux. */
export type LinuxX64Fields = {
  readonly arch: "x64";
  /** FLOATING: Google's current stable Chrome (apt images only; there is
   * no arm64 build). With a system browser, puppeteer tests skip their
   * per-run ~300MB Chrome-for-Testing download. null on distros without a
   * .deb path (alpine). */
  readonly chromeDebUrl: string | null;
};

export type LinuxAarch64Fields = {
  readonly arch: "aarch64";
};

/** The single build host: cross-compiles every target, so it (and only
 * it) carries the cross toolchains + sysroots. */
export type LinuxBuildHostImage = LinuxImageBase &
  (LinuxX64Fields | LinuxAarch64Fields) & {
    readonly buildHost: true;
    readonly crossToolchains: CrossToolchains;
  };

/** A native test image: builds nothing, cross-compiles nothing. */
export type LinuxTestImage = LinuxImageBase &
  (LinuxX64Fields | LinuxAarch64Fields) & {
    readonly buildHost: false;
  };

export type LinuxImage = LinuxBuildHostImage | LinuxTestImage;

/** The fields every linux image shares — the type of spec.ts's shared
 * object, so a mistake in it errors at the source instead of surfacing
 * (or not) inside whichever entry spreads it. Derived from the base, never a
 * second field list. */
export type LinuxSharedFields = Pick<
  LinuxImageBase,
  | "os"
  | "cloud"
  | "nodejs"
  | "bun"
  | "llvm"
  | "cmake"
  | "curlH3"
  | "buildkiteAgent"
  | "age"
  | "pythonFuse"
  | "rust"
  | "paths"
  | "system"
  | "dockerInstallUrl"
  | "tailscaleInstallUrl"
>;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** Fields on every windows image (an Azure gallery image built with
 * Packer). */
export type WindowsImageBase = {
  readonly key: string;
  readonly os: "windows";
  readonly release: string;
  readonly cloud: "azure";
  /** FLOATING: `version: "latest"` resolves at bake time. */
  readonly base: {
    readonly publisher: string;
    readonly offer: string;
    readonly sku: string;
    readonly version: string;
  };
  readonly bake: { readonly vmSize: string; readonly diskSizeGb: number };
  /** Azure Compute Gallery destination. Replication mirrors robobun's
   * spot-capacity region fallback list (a VM in region X needs a replica in
   * X). `null` = the gallery's home region. */
  readonly gallery: {
    readonly name: string;
    readonly location: string;
    readonly resourceGroup: string;
    readonly imageVersion: string;
    readonly storageAccountType: string;
    readonly packerVersion: string;
    readonly packerAzurePluginVersion: string;
    readonly replicationRegions: readonly (string | null)[];
  };
  readonly nodejs: NodejsSpec;
  readonly bun: BunSpec;
  readonly llvm: LlvmSpec;
  readonly curlH3: PinnedRelease;
  readonly buildkiteAgent: PinnedRelease;
  readonly rust: {
    readonly home: string;
    /** FLOATING: rustup-init.exe and the toolchain it selects. */
    readonly rustupUrl: string;
  };
  /** Scoop-installed packages, in install order. FLOATING bucket versions
   * except where a version is embedded (`nodejs@x`, `llvm@x`). */
  readonly scoop: {
    readonly installUrl: string;
    readonly root: string;
    readonly packages: readonly { readonly name: string; readonly command: string }[];
  };
  readonly powershell: PinnedRelease;
  /** Add-WindowsCapability needs DISM elevation unavailable in Packer's
   * WinRM session, hence the GitHub release. */
  readonly openssh: PinnedRelease;
  readonly ccache: PinnedRelease;
  /** FLOATING: latest VS 17 bootstrapper. */
  readonly visualStudio: {
    readonly bootstrapperUrl: string;
    readonly workloadArgs: readonly string[];
  };
  /** nssm mirror fallback for when nssm.cc (Scoop's source) is down. */
  readonly nssmFallbackZipUrl: string;
  readonly pdbAddr2line: { readonly version: string };
  /** The things baked onto this image, by component name, in install
   * order (see LinuxImageBase.components). */
  readonly components: readonly string[];
  /** Every path a windows bake writes to, rooted so each is written once
   * (see components/paths.ts for how components compose from these). */
  readonly paths: {
    /** Small tools survive Sysprep here (bun, curl-h3, pdb-addr2line, nssm). */
    readonly system32: string;
    /** Where multi-file installs land (ccache, ...). */
    readonly programFiles: string;
    readonly buildkiteHome: string;
    /** Filename of the bundled agent inside buildkiteHome (see linux). */
    readonly buildkiteAgentEntry: string;
    readonly prefetchDir: string;
    readonly installCacheDir: string;
    /** Where the Scoop-installed node lands; the agent service runs it. */
    readonly node: string;
  };
  /** CI-only optimizations (Defender off, services disabled, high-perf
   * power). */
  readonly optimize: {
    readonly disabledServices: readonly string[];
    readonly powerScheme: string;
  };
};

/** x64 Windows: has the Intel SDE (verify-baseline emulates a pre-AVX CPU)
 * and the x64-only Scoop packages (nasm, mingw). */
export type WindowsX64Image = WindowsImageBase & {
  readonly arch: "x64";
  /** Baked because Intel's mirror sits behind a bot challenge; the
   * unmodified tarball is mirrored on our blob storage (permitted by the
   * Intel Simplified Software License). To bump: download the new
   * sde-external-<version>-win.tar.xz from
   * https://www.intel.com/content/www/us/en/download/684897/ in a browser,
   * upload it to the artifacts container, then update version and sha256
   * (Intel publishes the SHA256 on the download page). */
  readonly intelSde: {
    readonly version: string;
    readonly sha256: string;
    readonly mirrorBase: string;
    readonly installDir: string;
  };
};

export type WindowsArm64Image = WindowsImageBase & {
  readonly arch: "aarch64";
};

export type WindowsImage = WindowsX64Image | WindowsArm64Image;

/** The fields every windows image shares (see LinuxSharedFields). */
export type WindowsSharedFields = Pick<
  WindowsImageBase,
  | "os"
  | "cloud"
  | "gallery"
  | "nodejs"
  | "bun"
  | "llvm"
  | "curlH3"
  | "buildkiteAgent"
  | "rust"
  | "powershell"
  | "openssh"
  | "ccache"
  | "visualStudio"
  | "nssmFallbackZipUrl"
  | "pdbAddr2line"
  | "paths"
  | "optimize"
>;

export type Image = LinuxImage | WindowsImage;
