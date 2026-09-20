import type { Arch, Image, Tool } from "../image.ts";

/**
 * Bun's build of ninja (oven-sh/ninja), in a directory of its own that is not
 * on PATH: the `ninja` the build runs is still the machine's own. A release
 * has one zip per platform, with `ninja` at its root, and publishes each zip's
 * sha256 in its `bun-ninja.json`. The Linux binary is static, so every distro
 * gets the same one.
 */
export function bunNinja(image: Image, pin: { tag: string; sha256: Record<`${Image["os"]}-${Arch}`, string> }): Tool {
  const platform = `${image.os}-${image.arch}` as const;
  const url = `https://github.com/oven-sh/ninja/releases/download/${pin.tag}/bun-ninja-${platform}.zip`;
  return {
    name: "bun-ninja",
    script: { linux: "linux/bun-ninja.sh", windows: "windows/bun-ninja.ps1", darwin: "macos/bun-ninja.sh" }[image.os],
    variables: {
      BUN_NINJA_URL: url,
      BUN_NINJA_SHA256: pin.sha256[platform],
      BUN_NINJA_DIR: image.os === "windows" ? "C:\\Program Files\\bun-ninja" : "/opt/bun-ninja",
    },
  };
}
