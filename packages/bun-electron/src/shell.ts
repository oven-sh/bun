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

export const shell = {
  async openExternal(url: string): Promise<void> {
    if (!SCHEME_RE.test(url)) {
      throw new Error(`openExternal: invalid URL '${url}'`);
    }
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? // Not cmd.exe: "start" goes through cmd's parser, where URL
            // metacharacters (&, |, %) become injection. rundll32's
            // FileProtocolHandler receives the URL as a plain argument.
            ["rundll32", "url.dll,FileProtocolHandler", url]
          : ["xdg-open", url];
    await spawnChecked(cmd);
  },

  async openPath(target: string): Promise<string> {
    try {
      // Absolute paths cannot start with "-", so they cannot be read as
      // flags by open/xdg-open/explorer.
      const abs = path.resolve(target);
      const cmd =
        process.platform === "darwin"
          ? ["open", abs]
          : process.platform === "win32"
            ? ["rundll32", "url.dll,FileProtocolHandler", abs]
            : ["xdg-open", abs];
      await spawnChecked(cmd);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
};
