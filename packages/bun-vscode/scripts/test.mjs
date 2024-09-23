import { exec } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

let { pathname } = new URL("..", import.meta.url);
if (process.platform === "win32") {
  pathname = path.normalize(pathname).substring(1); // remove leading slash
}
process.chdir(pathname);

let extPath;
for (const filename of readdirSync("extension")) {
  if (filename.endsWith(".vsix")) {
    extPath = `extension/${filename}`;
    break;
  }
}

if (!extPath) {
  throw new Error("No .vsix file found");
}

exec(`code --new-window --install-extension=${path} --extensionDevelopmentPath=${pathname} example`, {
  stdio: "inherit",
});
