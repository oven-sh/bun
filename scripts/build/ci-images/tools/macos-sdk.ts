import type { Tool } from "../image.ts";

/**
 * `/opt/macos-sdk/MacOSX<version>.sdk`, unpacked from Apple's Command Line
 * Tools by scripts/build/xmac.mjs. The generator copies that script into the
 * bake directory, so it is part of the image's hash.
 */
export function macosSdk(pin: { sdk: string; commandLineTools: string }): Tool {
  return {
    name: "macos-sdk",
    script: "linux/macos-sdk.sh",
    variables: { MACOS_SDK_VERSION: pin.sdk, MACOS_CLT_RELEASE: pin.commandLineTools },
    urls: [],
    files: { "xmac.mjs": "scripts/build/xmac.mjs" },
  };
}
