import { buildSync } from "esbuild";
import { rmSync, mkdirSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { pathname } = new URL("..", import.meta.url);
process.chdir(pathname);

buildSync({
  entryPoints: ["src/extension.ts", "src/web-extension.ts"],
  outdir: "dist",
  bundle: true,
  external: ["vscode"],
  platform: "node",
  format: "cjs",
});

rmSync("extension", { recursive: true, force: true });
mkdirSync("extension", { recursive: true });
cpSync("dist", "extension/dist", { recursive: true });
cpSync("assets", "extension/assets", { recursive: true });
cpSync("README.md", "extension/README.md");
cpSync("LICENSE", "extension/LICENSE");
cpSync("package.json", "extension/package.json");

const cmd = process.isBun ? "bunx" : "npx";
spawnSync(cmd, ["vsce", "package"], {
  cwd: "extension",
  stdio: "inherit",
});
