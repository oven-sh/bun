// Content-addressed CI image names.
//
// An image is named `${entry.key}-${imageHash(entry)}` where the hash is a
// digest of the image's spec ENTRY as a value: its record from spec.ts,
// serialized canonically (sorted keys, no whitespace) and sha256'd. It is
// the value that is hashed, not the source text — a comment, a reformat, or
// a key reorder in spec.ts changes no value and so renames nothing. Change
// a fact in the entry → the hash changes → CI bakes it; unchanged → the
// name matches an existing image → CI reuses it. No version to bump.
//
// The same name is used for the AWS AMI and the Azure gallery image
// definition, and robobun launches CI machines by looking that exact name
// up — no wildcards, no version numbers, no newest-wins.

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { images } from "./images.ts";
import type { Image } from "./types.ts";

/** Length of the hex hash suffix. 16 hex chars = 64 bits; collision odds
 * across the handful of specs that ever exist are negligible. */
const HASH_LENGTH = 16;

/** Deterministic JSON: keys sorted at every level, arrays in order. An
 * undefined field is the same as an absent one (both are dropped), so an
 * entry written with `field: undefined` hashes like one that omits it. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** The hex digest of one image's entry value. */
export function imageHash(entry: Image): string {
  return createHash("sha256").update(canonicalJson(entry)).digest("hex").slice(0, HASH_LENGTH);
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
      `No image entry with key "${key}" in the CI image spec.\n` +
        `Known keys: ${images.map(image => image.key).join(", ")}\n` +
        `Add an entry to the spec so CI can bake it.`,
    );
  }
  return entry;
}

// `node scripts/build/ci/naming.ts` — print every image's current name.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  for (const image of images) console.log(imageName(image));
}
