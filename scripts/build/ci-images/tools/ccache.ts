import type { Tool, WindowsImage } from "../image.ts";

/** Linux images take ccache from their distro's packages. */
export function ccache(image: WindowsImage, pin: { version: string }): Tool {
  const directory = `ccache-${pin.version}-windows-${image.arch === "x64" ? "x86_64" : "aarch64"}`;
  const url = `https://github.com/ccache/ccache/releases/download/v${pin.version}/${directory}.zip`;
  return {
    name: "ccache",
    script: "windows/ccache.ps1",
    variables: { CCACHE_URL: url, CCACHE_DIRECTORY: directory, CCACHE_VERSION: pin.version },
    urls: [url],
  };
}
