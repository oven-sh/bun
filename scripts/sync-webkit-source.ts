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
const cmakeContents = await Bun.file(join(bunRepo, "cmake/tools/SetupWebKit.cmake")).text();
const expectedCommit = cmakeContents.match(/set\(WEBKIT_VERSION ([0-9a-f]{40})\)/)![1];

if (checkedOutCommit == expectedCommit) {
  console.log(`already at commit ${expectedCommit}`);
} else {
  console.log(`changing from ${checkedOutCommit} to ${expectedCommit}`);
  await Bun.$`git checkout main`;
  await Bun.$`git pull`;
  // it is OK that this leaves you with a detached HEAD
  await Bun.$`git checkout ${expectedCommit}`;
}
