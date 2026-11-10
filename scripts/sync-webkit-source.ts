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
// config.ts and deps/webkit.ts import each other; evaluating config.ts first
// matches the build's entry order so WEBKIT_VERSION initializes before use.
await import("./build/config.ts");
const { WEBKIT_VERSION } = await import("./build/deps/webkit.ts");

// WEBKIT_VERSION is either a 40-hex commit sha or an autobuild-* release tag.
// Resolve it to the commit it points at; preview tags sit on unmerged
// oven-sh/WebKit PR heads, so plain `git pull` on main never fetches them.
async function resolveToSha(): Promise<string> {
  const out = await Bun.$`git rev-parse --verify ${WEBKIT_VERSION}^{commit}`.quiet().nothrow();
  return out.exitCode === 0 ? out.text().trim() : "";
}

let expectedSha = await resolveToSha();
if (!expectedSha) {
  await Bun.$`git fetch --tags origin`;
  expectedSha = await resolveToSha();
}
if (!expectedSha) {
  console.log(`could not resolve ${WEBKIT_VERSION} in vendor/WebKit even after fetching`);
  console.log("check that the commit or tag exists on https://github.com/oven-sh/WebKit");
  process.exit(1);
}

if (checkedOutCommit === expectedSha) {
  console.log(`already at ${WEBKIT_VERSION} (${expectedSha})`);
} else {
  console.log(`changing from ${checkedOutCommit} to ${WEBKIT_VERSION} (${expectedSha})`);
  // it is OK that this leaves you with a detached HEAD
  await Bun.$`git checkout ${expectedSha}`;
}
