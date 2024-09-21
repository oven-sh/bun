import { buildSync } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

let { pathname } = new URL("..", import.meta.url);
if (process.platform === "win32") {
  pathname = path.normalize(pathname).substring(1); // remove leading slash
}
process.chdir(pathname);

buildSync({
  entryPoints: ["src/extension.ts", "src/web-extension.ts"],
  outdir: "dist",
  bundle: true,
  external: ["vscode"],
  platform: "node",
  format: "cjs",
  // The following settings are required to allow for extension debugging
  minify: false,
  sourcemap: true,
});

rmSync("extension", { recursive: true, force: true });
mkdirSync("extension", { recursive: true });
cpSync("dist", "extension/dist", { recursive: true });
cpSync("assets", "extension/assets", { recursive: true });
cpSync("README.md", "extension/README.md");
cpSync("LICENSE", "extension/LICENSE");
cpSync("package.json", "extension/package.json");

const cmd = process.isBun ? "bunx" : "npx";
execSync(`${cmd} vsce package --no-dependencies`, {
  cwd: "extension",
  stdio: "inherit",
});
