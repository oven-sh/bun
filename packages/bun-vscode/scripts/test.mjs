import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";

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

spawn("code", [`--install-extension=${path}`, "--new-window"], {
  detached: true,
  stdio: "ignore",
});
