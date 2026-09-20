import type { Tool } from "../image.ts";

/** Debian and Ubuntu mount /tmp in memory; builds and tests write gigabytes there. */
export function noTmpfs(): Tool {
  return { name: "no-tmpfs", script: "linux/no-tmpfs.sh", variables: {} };
}
