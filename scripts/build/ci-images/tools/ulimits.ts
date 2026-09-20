import type { LinuxImage, Tool } from "../image.ts";

/** Tests open many files and dump large cores: no limit is left at the distro's default. */
export function ulimits(image: LinuxImage): Tool {
  return {
    name: "ulimits",
    script: image.distro === "alpine" ? "linux/ulimits.openrc.sh" : "linux/ulimits.systemd.sh",
    variables: { MAX_OPEN_FILES: "1048576", MAX_PROCESSES: "1048576" },
  };
}
