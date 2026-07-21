// Content-addressed CI image names.
//
// An image is named `${entry.key}-${imageHash(entry)}` where the hash digests
// `spec.epoch` + that image's ENTIRE entry + the RESOLVED artifact bundle
// it produces (every concrete download URL/checksum, from
// artifacts.resolveArtifacts). spec.ts stays pure data; the URL
// construction is code in artifacts.ts, but its OUTPUT is hashed here, so
// editing a URL template re-bakes exactly like editing a version does.
// Other code (bootstrap, agent.mjs) is never hashed; see spec.epoch for
// how a code change reaches the images.
//
// The same name is used for the AWS AMI and the Azure gallery image
// definition, and robobun launches CI machines by looking that exact name
// up — no wildcards, no version numbers, no newest-wins.

import { createHash } from "node:crypto";
import { resolveArtifacts } from "./components/registry.ts";
import { epoch, images } from "./spec.ts";
import type { Arch, Image } from "./types.ts";

/** Length of the hex hash suffix. 16 hex chars = 64 bits; collision odds
 * across the handful of specs that ever exist are negligible. */
const HASH_LENGTH = 16;

/**
 * Deterministic JSON: objects have their keys sorted; everything else is
 * standard. Used only for hashing, so it only has to be stable, not pretty.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** The hex digest of one image's full manifest + resolved downloads
 * (+ epoch). */
export function imageHash(entry: Image): string {
  return createHash("sha256")
    .update(canonicalJson({ epoch, image: entry, artifacts: resolveArtifacts(entry) }))
    .digest("hex")
    .slice(0, HASH_LENGTH);
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
  features?: string[];
  abi?: string;
  crossCompile?: boolean;
}): string {
  const { os, arch, distro, release, features, abi, crossCompile } = platform;
  const hostOs = os === "freebsd" || crossCompile ? "linux" : os;
  let key = `${hostOs}-${arch}-${release.replace(/\./g, "")}`;
  if (distro) {
    key += `-${distro}`;
  }
  if (features?.length) {
    key += `-with-${features.join("-")}`;
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

/** The entry for a raw os/arch/distro/release (machine.mjs's CLI shape). */
export function imageEntryFor(os: string, arch: Arch, distro: string | undefined, release: string): Image {
  return imageEntry(imageKey(distro === undefined ? { os, arch, release } : { os, arch, release, distro }));
}
