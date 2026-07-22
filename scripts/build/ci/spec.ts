// The single source of truth for what goes into a Bun CI machine image.
//
// Every image is one fully-typed entry in `images` below: a complete manifest
// of what gets baked onto that machine — pinned tool versions, package
// lists, cross toolchains, base image, bake shape, and system tuning. The
// values are PLAIN DATA (no functions). Facts shared between images (the
// Node.js version, the LLVM version, ...) are declared once as constants and
// referenced by each entry, so there is exactly one place to change them.
// Nothing else in the repo may re-declare one of these values — bootstrap,
// ci.mjs, machine.mjs, and scripts/build/* import them from here. URL
// construction and other logic over this data lives in ./artifacts.ts.
//
// The types are the checklist: LinuxBuildHostImage requires the cross
// toolchains that LinuxTestImage may not have; WindowsX64Image requires the
// Intel SDE + x64-only Scoop packages that WindowsArm64Image may not have.
// A field that only some images bake exists only on those images' types.
//
// An image is named `${entry.key}-${hash}` (see ./naming.ts) where the hash
// is a digest of that image's GENERATED files (build/ci/<key>/ — the
// self-contained bootstrap.ts, the Packer template, the agent bundle),
// which ./generate.ts renders from the entry here plus the recipe code. So:
//
//   - Change a fact an image references, or the code that renders it → its
//     files change → its hash changes → CI bakes it fresh on that branch and
//     reuses it on every later push. There is no `[build images]` /
//     `[publish images]` step and no version number to bump; merging to
//     main IS publishing, because main renders the same files.
//
//   - Whether an image bakes is a mechanical consequence of the generated
//     files — never something to remember. A refactor that renders
//     identical files renames nothing.
//
// What a hash means: "same recipe", not "same bytes". Some inputs float by
// nature (OS package repositories, `latest` cloud base images, installer
// scripts served from a fixed URL). Those are marked FLOATING below. When one
// of them drifts underneath us in a way that breaks the image, bump `epoch`
// to force a re-bake — the one input that exists solely to be bumped.
//
// This module is imported by both node (>= 25, via type stripping) and bun.
// Keep it dependency-free, side-effect-free, function-free, and made of
// erasable TypeScript syntax only (no enums / namespaces).

import type { AgeSpec, BunSpec, CrossToolchains, LlvmSpec, NodejsSpec, PinnedRelease } from "./types.ts";

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

/**
 * Included in every image's hash. Bump to force every image to re-bake
 * without changing any fact or code — for when a FLOATING input drifted
 * underneath us in a way that broke the image.
 */
export const epoch = 1;

/** Packer + provider plugin pins for the Windows bake (azure-arm). These
 * are recipe inputs: spec.ts is hashed, so bumping a pin renames the images
 * and rebakes them — a Packer upgrade legitimately can change the result. */
export const packer = {
  version: "1.15.0",
  amazonPluginVersion: "1.3.9",
  azurePluginVersion: "2.5.0",
} as const;
// ---------------------------------------------------------------------------
// Shared facts — declared once, referenced by every image that needs them
// ---------------------------------------------------------------------------

export const nodejs: NodejsSpec = {
  version: "26.3.0",
  gypInstallVersion: "11",
  distBase: "https://nodejs.org/dist",
  muslDistBase: "https://unofficial-builds.nodejs.org/download/release",
  headersDistBase: "https://nodejs.org/download/release",
};

export const bun: BunSpec = {
  version: "1.3.14",
  releaseBase: "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases",
};

/** FLOATING on linux via apt.llvm.org (serves the current point release
 * of `major`, currently `version`); pinned exactly via Scoop on Windows. */
export const llvm: LlvmSpec = {
  version: "21.1.8",
  major: 21,
  aptScriptUrl: "https://apt.llvm.org/llvm.sh",
};

export const cmake: PinnedRelease = {
  version: "3.30.5",
  releaseBase: "https://github.com/Kitware/CMake/releases/download",
};

/** Static curl with nghttp3/ngtcp2, installed as `curl-h3` for the HTTP/3
 * server tests. https://github.com/stunnel/static-curl/releases */
export const curlH3: PinnedRelease = {
  version: "8.19.0",
  releaseBase: "https://github.com/stunnel/static-curl/releases/download",
};

export const buildkiteAgent: PinnedRelease = {
  version: "3.114.0",
  releaseBase: "https://github.com/buildkite/agent/releases/download",
};

export const age: AgeSpec = {
  version: "1.2.1",
  releaseBase: "https://github.com/FiloSottile/age/releases/download",
  sha256: {
    "linux-amd64": "7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50",
    "linux-arm64": "57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f",
  },
};

export const pythonFuse: PinnedRelease = {
  version: "1.0.9",
  releaseBase: "https://github.com/libfuse/python-fuse/archive/refs/tags",
};

/** The alpine release the musl lanes run on. The alpine images, the musl
 * sysroot, and the verify-baseline host all follow it. */
export const alpineRelease = "3.23";

export const crossToolchains: CrossToolchains = {
  winSysroot: {
    xwinVersion: "0.9.0",
    xwinReleaseBase: "https://github.com/Jake-Shadle/xwin/releases/download",
    sdkVersion: "10.0.26100",
    crtVersion: "14.44.17.14",
    path: "/opt/winsysroot",
  },
  macosSdk: {
    version: "26.5",
    cltRelease: "26.5",
    path: "/opt/macos-sdk",
    xmacRawBase: "https://raw.githubusercontent.com/oven-sh/bun",
  },
  androidNdk: {
    version: "r27c",
    releaseBase: "https://dl.google.com/android/repository",
    path: "/opt/android-ndk",
  },
  freebsdSysroot: {
    version: "14.3",
    releaseBase: "https://download.freebsd.org/releases",
    paths: { amd64: "/opt/freebsd-sysroot", arm64: "/opt/freebsd-sysroot-arm64" },
  },
  glibcSysroot: {
    ubuntuImage: "docker.io/library/ubuntu:20.04",
    glibcVersion: "2.31",
    paths: { x86_64: "/opt/linux-sysroot-glibc", aarch64: "/opt/linux-sysroot-glibc-arm64" },
    aptBase: { x86_64: "http://archive.ubuntu.com/ubuntu", aarch64: "http://ports.ubuntu.com/ubuntu-ports" },
    dists: ["focal-updates", "focal"],
    packages: ["libc6", "libc6-dev", "linux-libc-dev", "libcrypt1", "libcrypt-dev"],
    // gcc-13 (libstdc++-13-dev, libgcc-13-dev) debs mirrored on a WebKit
    // release; assets are gcc-13-focal-{amd64,arm64}.tar.gz.
    gcc13ReleaseBase: "https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs",
  },
  muslSysroot: {
    alpineRelease,
    paths: { x86_64: "/opt/linux-sysroot-musl", aarch64: "/opt/linux-sysroot-musl-arm64" },
    packages: ["musl-dev", "libc-dev", "linux-headers", "g++", "libstdc++-dev"],
    cdnBase: "https://dl-cdn.alpinelinux.org/alpine",
  },
  // The build host is aarch64, so it needs the x86-64 GNU strip.
  crossBinutils: ["binutils-x86-64-linux-gnu"],
};
