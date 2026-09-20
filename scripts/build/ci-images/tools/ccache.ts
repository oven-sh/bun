import type { Tool, WindowsImage } from "../image.ts";

/** Linux images take ccache from their distro's packages. */
export function ccache(image: WindowsImage, pin: { version: string }, directory: string): Tool {
  const archiveRoot = `ccache-${pin.version}-windows-${image.arch === "x64" ? "x86_64" : "aarch64"}`;
  const url = `https://github.com/ccache/ccache/releases/download/v${pin.version}/${archiveRoot}.zip`;
  return {
    name: "ccache",
    script: "windows/ccache.ps1",
    variables: { CCACHE_DIR: directory, CCACHE_URL: url, CCACHE_ARCHIVE_ROOT: archiveRoot },
  };
}
