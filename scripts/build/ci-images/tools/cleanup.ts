import type { LinuxImage, Tool } from "../image.ts";

/** The last step: what a bake leaves behind that the image has no use for. */
export function cleanup(image: LinuxImage): Tool {
  return {
    name: "cleanup",
    script: image.distro === "alpine" ? "linux/cleanup.apk.sh" : "linux/cleanup.apt.sh",
    variables: {},
  };
}
