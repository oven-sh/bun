// Pinned CEF binary distribution. Update by picking a stable version for all
// platforms from https://cef-builds.spotifycdn.com/index.json.
export const CEF_VERSION = "148.0.9+g0d9d52a+chromium-148.0.7778.180";
export const CEF_CDN = "https://cef-builds.spotifycdn.com";

export function cefPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const is64 = arch === "x64";
  const isArm = arch === "arm64";
  switch (platform) {
    case "linux":
      return is64 ? "linux64" : isArm ? "linuxarm64" : unsupported(platform, arch);
    case "darwin":
      return is64 ? "macosx64" : isArm ? "macosarm64" : unsupported(platform, arch);
    case "win32":
      return is64 ? "windows64" : isArm ? "windowsarm64" : unsupported(platform, arch);
    default:
      return unsupported(platform, arch);
  }
}

function unsupported(platform: string, arch: string): never {
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export function cefArchiveName(platform = cefPlatform()): string {
  return `cef_binary_${CEF_VERSION}_${platform}_minimal`;
}

export function cefArchiveUrl(platform = cefPlatform()): string {
  return `${CEF_CDN}/${encodeURIComponent(cefArchiveName(platform))}.tar.bz2`;
}
