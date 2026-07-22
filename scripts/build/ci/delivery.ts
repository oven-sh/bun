// Getting the generated bootstrap onto a fresh linux machine and running it.
//
// A bare base image has neither bun nor node. The image entry pins the
// node the image ships with, so the bake fetches exactly that node onto the
// box and runs the generated, self-contained bootstrap.ts under it (that
// node executes .ts via type stripping). The same tarball then satisfies
// the bootstrap's own node install.

import { nodejsDownload, nodejsFolderName } from "./artifacts.ts";
import type { LinuxImage } from "./types.ts";

/** Where the generated bootstrap.ts and the fetched node land on a bake VM. */
export const LINUX_REMOTE_ROOT = "/tmp/bun-bootstrap";
/** The generated file's remote path (uploaded by machine.ts). */
export const LINUX_REMOTE_BOOTSTRAP = `${LINUX_REMOTE_ROOT}/bootstrap.ts`;

/**
 * POSIX script that downloads the spec-pinned node into the remote root and
 * runs the generated bootstrap.ts with the given flags. Reads no host state
 * and pins nothing itself: the node URL and folder come from the image
 * entry. Fetches with curl when present and falls back to wget (alpine
 * cloud images ship busybox wget but not always curl).
 */
export function linuxBootstrapCommand(image: LinuxImage, args: { ci: boolean; repoRef: string }): string {
  const node = nodejsDownload(image.nodejs, "linux", image.arch, image.abi);
  const folder = nodejsFolderName(image.nodejs, "linux", image.arch, image.abi);
  const flags: string[] = [];
  if (args.ci) flags.push("--ci", `--repo-ref=${args.repoRef}`);
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
    `echo ">>> Running bootstrap: $NODE ${LINUX_REMOTE_BOOTSTRAP} ${flags.join(" ")}"`,
    `"$NODE" ${LINUX_REMOTE_BOOTSTRAP} ${flags.join(" ")}`,
  ].join("\n");
}
