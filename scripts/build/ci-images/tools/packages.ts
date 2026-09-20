import type { LinuxImage, Tool } from "../image.ts";

/**
 * Packages from the distro's own repositories. Their names are part of the
 * image's hash; their versions are whatever the repository serves on the day
 * of the bake.
 */
export function packages(image: LinuxImage, names: readonly string[]): Tool {
  return {
    name: "packages",
    script: image.distro === "alpine" ? "linux/packages.apk.sh" : "linux/packages.apt.sh",
    variables: { PACKAGES: names.join(" ") },
    urls: [],
  };
}
