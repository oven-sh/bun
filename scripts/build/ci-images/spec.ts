/**
 * Bun's CI machine images: which exist, what each is built from, and the
 * version of everything installed on them. This is the only place those
 * versions are written; the rest of the repository imports them from here.
 *
 * Changing anything in this file changes the hash of the images it affects,
 * and the next CI build bakes the images whose names do not exist yet.
 */

import type { LinuxImage, Tool } from "./image.ts";
import { agentUser } from "./tools/agent-user.ts";
import { buildkiteAgent } from "./tools/buildkite-agent.ts";
import { bun } from "./tools/bun.ts";
import { curlH3 } from "./tools/curl-h3.ts";
import { nodejs } from "./tools/nodejs.ts";
import { packages } from "./tools/packages.ts";
import { ulimits } from "./tools/ulimits.ts";

export const pins = {
  nodejs: { version: "26.3.0", nodeGypInstallVersion: "11" },
  bun: { version: "1.3.13" },
  curlH3: { version: "8.19.0" },
  buildkiteAgent: { version: "3.114.0" },
} as const;

export const images: readonly LinuxImage[] = [
  {
    os: "linux",
    arch: "x64",
    distro: "debian",
    release: "13",
    abi: "gnu",
    role: "test",
    base: { name: "debian-13-amd64-20260914-2601", owner: "amazon" },
  },
  {
    os: "linux",
    arch: "x64",
    distro: "alpine",
    release: "3.23",
    abi: "musl",
    role: "test",
    base: { name: "alpine-3.23.6-x86_64-uefi-cloudinit-r0", owner: "538276064493" },
  },
  {
    os: "linux",
    arch: "aarch64",
    distro: "alpine",
    release: "3.23",
    abi: "musl",
    role: "test",
    base: { name: "alpine-3.23.6-aarch64-uefi-cloudinit-r0", owner: "538276064493" },
  },
];

/** What a bake installs on a Linux image, in order. */
export function linuxTools(image: LinuxImage): readonly Tool[] {
  return [
    packages(
      image,
      image.distro === "alpine"
        ? ["bash", "ca-certificates", "curl", "git", "unzip", "tar", "xz", "libgcc", "libstdc++"]
        : // libatomic1: nodejs.org's binary links it.
          ["bash", "ca-certificates", "curl", "git", "unzip", "xz-utils", "libatomic1"],
    ),
    ulimits(image),
    agentUser(image),
    nodejs(image, pins.nodejs),
    bun(image, pins.bun),
    curlH3(image, pins.curlH3),
    buildkiteAgent(image, pins.buildkiteAgent),
  ];
}
