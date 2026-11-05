export function describe() {
  const { platform, arch } = process;
  return platform + "/" + arch + "/" + ["linux", "darwin", "win32"].includes(platform);
}
