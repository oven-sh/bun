import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";

const { pathname } = new URL("..", import.meta.url);
process.chdir(pathname);

let path;
for (const filename of readdirSync("extension")) {
  if (filename.endsWith(".vsix")) {
    path = `extension/${filename}`;
    break;
  }
}

if (!path) {
  throw new Error("No .vsix file found");
}

spawn("code", ["--new-window", `--install-extension=${path}`, `--extensionDevelopmentPath=${pathname}`, "example"], {
  stdio: "inherit",
});
