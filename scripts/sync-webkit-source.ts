import { existsSync } from "node:fs";
import { join } from "node:path";

// The clone `bun run build:local` builds (--local-deps=WebKit=$BUN_WEBKIT_PATH).
const webkitRepo = process.env.BUN_WEBKIT_PATH;
if (!webkitRepo || !existsSync(join(webkitRepo, ".git"))) {
  console.log(
    "could not find your WebKit clone: $BUN_WEBKIT_PATH " +
      (webkitRepo ? `(${webkitRepo}) is not a git checkout` : "is not set"),
  );
  console.log(
    "clone https://github.com/oven-sh/WebKit.git somewhere outside vendor/ and export BUN_WEBKIT_PATH=<that path>",
  );
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
  console.log(`could not resolve ${WEBKIT_VERSION} in ${webkitRepo} even after fetching`);
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
