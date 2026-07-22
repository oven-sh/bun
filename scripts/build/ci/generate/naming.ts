// Content-addressed CI image names.
//
// An image is named `${entry.key}-${imageHash(entry)}` where the hash is a
// digest of the image's GENERATED files (build/ci/<key>/, from generate.ts):
// the self-contained bootstrap.ts, the Packer template, and the agent
// bundle. Those files are derived from spec.ts, so editing the spec (or the
// recipe code they are built from) changes the files, which changes the
// name, which makes CI bake. Files unchanged -> name unchanged -> reuse.
//
// The same name is used for the AWS AMI and the Azure gallery image
// definition, and robobun launches CI machines by looking that exact name
// up — no wildcards, no version numbers, no newest-wins.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { images } from "../images.ts";
import type { Image } from "../types.ts";
import { hashImageDir, imageOutDir } from "./outputs.ts";

/** Length of the hex hash suffix. 16 hex chars = 64 bits; collision odds
 * across the handful of specs that ever exist are negligible. */
const HASH_LENGTH = 16;

/**
 * The hex digest of one image's GENERATED files (build/ci/<key>/): the
 * self-contained bootstrap.ts, the Packer template, the agent bundle — the
 * exact bytes that are baked. Requires the files to have been generated
 * (bun scripts/build.ts, or scripts/build/ci/generate.ts).
 */
export function imageHash(entry: Image): string {
  const dir = imageOutDir(entry);
  if (!existsSync(join(dir, "bootstrap.ts"))) {
    throw new Error(
      `image "${entry.key}" has no generated files at ${dir}.\n` +
        `Run \`node scripts/build/ci/generate.ts\` (or \`bun scripts/build.ts\`) first.`,
    );
  }
  return hashImageDir(dir).slice(0, HASH_LENGTH);
}

/** The full name every consumer agrees on: robobun's `image-name` agent
 * tag, the AMI Name, and the Azure gallery image definition name. */
export function imageName(entryOrKey: Image | string): string {
  const entry = typeof entryOrKey === "string" ? imageEntry(entryOrKey) : entryOrKey;
  return `${entry.key}-${imageHash(entry)}`;
}

/**
 * The image key a CI platform maps to. Cross-compiled targets and FreeBSD
 * build on a linux host (the build host image cross-compiles everything), so
 * their host OS is linux; every native test platform maps to its own entry.
 */
export function imageKey(platform: {
  os: string;
  arch: string;
  release: string;
  distro?: string;
  abi?: string;
  crossCompile?: boolean;
}): string {
  const { os, arch, distro, release, abi, crossCompile } = platform;
  const hostOs = os === "freebsd" || crossCompile ? "linux" : os;
  let key = `${hostOs}-${arch}-${release.replace(/\./g, "")}`;
  if (distro) {
    key += `-${distro}`;
  }
  if (abi && abi !== "android") {
    key += `-${abi}`;
  }
  return key;
}

/** The spec entry for an image key, or a loud error listing what exists.
 * Called for every platform in the CI matrix, so a platform with no
 * bakeable image fails pipeline generation, not the bake. */
export function imageEntry(key: string): Image {
  const entry = images.find(image => image.key === key);
  if (!entry) {
    throw new Error(
      `No image entry with key "${key}" in scripts/build/ci/spec.ts.\n` +
        `Known keys: ${images.map(image => image.key).join(", ")}\n` +
        `Add an entry to spec.images (or fix the platform) so CI can bake it.`,
    );
  }
  return entry;
}
