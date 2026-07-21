// Getting bootstrap onto a fresh machine.
//
// A bare base image has neither bun nor node. The image spec pins the node
// the image ships with, so the bake fetches exactly that node onto the box
// and runs bootstrap.ts under it (that node executes .ts via type
// stripping). The same tarball then satisfies bootstrap's own node install.
//
// machine.mjs (which already has node and imports the spec) renders these
// snippets — there is no committed shell shim to keep in sync.

import { nodejsDownload, nodejsFolderName } from "./artifacts.ts";
import type { LinuxImage } from "./types.ts";

/** The bootstrap sources every bake VM needs: bootstrap.ts + its modules.
 * Paths are relative to the repo root. */
export const BOOTSTRAP_SOURCE_DIRS = ["scripts/build/ci"] as const;

/** Where the sources and the fetched node land on a linux bake VM. */
export const LINUX_REMOTE_ROOT = "/tmp/bun-bootstrap";

/**
 * POSIX script that downloads the spec-pinned node into the remote root and
 * runs bootstrap.ts with the given flags. Reads no host state and pins
 * nothing itself: the URL and folder come from the image entry. Fetches with
 * curl when present and falls back to wget (alpine cloud images ship
 * busybox wget but not always curl).
 */
export function linuxBootstrapCommand(image: LinuxImage, args: { ci: boolean; repoRef: string }): string {
  const node = nodejsDownload(image.nodejs, "linux", image.arch, image.abi);
  const folder = nodejsFolderName(image.nodejs, "linux", image.arch, image.abi);
  const flags = [`--image=${image.key}`];
  if (args.ci) flags.push("--ci", `--repo-ref=${args.repoRef}`);
  const bootstrap = `${LINUX_REMOTE_ROOT}/scripts/build/ci/bootstrap.ts`;
  return [
    "set -ex",
    `cd ${LINUX_REMOTE_ROOT}`,
    `echo ">>> Downloading node from ${node.url}"`,
    "if command -v curl >/dev/null 2>&1; then",
    `  curl -fsSL --retry 5 --retry-all-errors ${node.url} -o node.tar.gz`,
    "else",
    `  wget -q --tries=5 -O node.tar.gz ${node.url}`,
    "fi",
    "tar -xzf node.tar.gz",
    `NODE=${LINUX_REMOTE_ROOT}/${folder}/bin/node`,
    `"$NODE" --version`,
    `echo ">>> Running bootstrap: $NODE ${bootstrap} ${flags.join(" ")}"`,
    `"$NODE" ${bootstrap} ${flags.join(" ")}`,
  ].join("\n");
}
