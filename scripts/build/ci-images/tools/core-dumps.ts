import type { LinuxImage, Tool } from "../image.ts";

/** Where a crashing test leaves its core, and gdb to read it. scripts/runner.node.ts looks in the same directory. */
export function coreDumps(image: LinuxImage): Tool {
  return {
    name: "core-dumps",
    script: image.distro === "alpine" ? "linux/core-dumps.apk.sh" : "linux/core-dumps.apt.sh",
    variables: { CORES_DIR: `/var/bun-cores-${image.distro}-${image.release}-${image.arch}` },
    urls: [],
  };
}
