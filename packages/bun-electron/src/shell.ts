// shell — minimal Electron-compatible shell module.

import path from "node:path";

// Requires a well-formed scheme (RFC 3986). Also guarantees the argument
// cannot start with "-", so it can never be parsed as a flag by the
// launcher commands below.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

async function spawnChecked(cmd: string[]): Promise<void> {
  const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd[0]} exited with code ${code}`);
}

// Pure, platform-parameterized launcher command. Exposed so the per-OS branch
// (open / rundll32 / xdg-open) is verifiable on any host.
export function openCommandFor(platform: NodeJS.Platform, target: string): string[] {
  if (platform === "darwin") return ["open", target];
  if (platform === "win32") {
    // Not cmd.exe: "start" goes through cmd's parser, where URL metacharacters
    // (&, |, %) become injection. rundll32's FileProtocolHandler receives the
    // target as a plain argument.
    return ["rundll32", "url.dll,FileProtocolHandler", target];
  }
  return ["xdg-open", target];
}

export const shell = {
  async openExternal(url: string): Promise<void> {
    if (!SCHEME_RE.test(url)) {
      throw new Error(`openExternal: invalid URL '${url}'`);
    }
    await spawnChecked(openCommandFor(process.platform, url));
  },

  async openPath(target: string): Promise<string> {
    try {
      // Absolute paths cannot start with "-", so they cannot be read as
      // flags by open/xdg-open/explorer.
      const abs = path.resolve(target);
      await spawnChecked(openCommandFor(process.platform, abs));
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
};
