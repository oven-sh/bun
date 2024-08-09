import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { type as getOSType } from "node:os";

const { pathname } = new URL("..", import.meta.url);

if (getOSType() === "Windows_NT") {
  process.chdir(pathname.substring(1))
} else {
  process.chdir(pathname);
}

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
