// shell — minimal Electron-compatible shell module.

export const shell = {
  async openExternal(url: string): Promise<void> {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
    const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`Failed to open '${url}' (exit code ${code})`);
  },

  async openPath(path: string): Promise<string> {
    try {
      await this.openExternal(path);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
};
