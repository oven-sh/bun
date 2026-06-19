// Returns the argv used to open `url` in the system's default browser on the
// given platform. Kept platform-parameterized (rather than reading
// `process.platform` directly) so the mapping is unit-testable on any host via
// "bun:internal-for-testing".
//
// On Windows, `start` is a cmd.exe builtin, not an executable on PATH, so
// spawning it directly fails with ENOENT. It must be run through cmd.exe. The
// empty "" is `start`'s title argument: without it, `start` would treat the URL
// as the window title instead of the thing to open.
export function getBrowserOpenCommand(platform: string, url: string): string[] {
  switch (platform) {
    case "darwin":
      return ["open", url];
    case "win32":
      return ["cmd.exe", "/c", "start", "", url];
    case "android":
      return ["/system/bin/am", "start", "-a", "android.intent.action.VIEW", "-d", url];
    default:
      return ["xdg-open", url];
  }
}
