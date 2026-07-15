import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const bunRepo = dirname(import.meta.dir);
const webkitRepo = join(bunRepo, "vendor/WebKit");
if (!existsSync(webkitRepo)) {
  console.log("could not find WebKit clone");
  console.log("clone https://github.com/oven-sh/WebKit.git to vendor/WebKit");
  console.log("or create a symlink/worktree to an existing clone");
  process.exit(1);
}

process.chdir(webkitRepo);
const checkedOutCommit = (await Bun.$`git rev-parse HEAD`.text()).trim();
const { WEBKIT_VERSION: expectedCommit } = await import("./build/deps/webkit.ts");

if (checkedOutCommit == expectedCommit) {
  console.log(`already at commit ${expectedCommit}`);
} else {
  console.log(`changing from ${checkedOutCommit} to ${expectedCommit}`);
  await Bun.$`git checkout main`;
  await Bun.$`git pull`;
  // it is OK that this leaves you with a detached HEAD
  await Bun.$`git checkout ${expectedCommit}`;
}
