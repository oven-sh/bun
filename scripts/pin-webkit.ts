/**
 * Writes scripts/build/deps/webkit.sha256: the sha256 of every tarball of the release that WEBKIT_VERSION names, as
 * GitHub computed it when the file was uploaded. Run after changing WEBKIT_VERSION: `bun run pin-webkit`.
 */

import { writeFileSync } from "node:fs";

// config.ts and deps/webkit.ts import each other; evaluating config.ts first matches the build's entry order.
await import("./build/config.ts");
const { WEBKIT_VERSION, webkitReleaseTag, webkitSha256Sums } = await import("./build/deps/webkit.ts");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const tag = webkitReleaseTag(WEBKIT_VERSION);
const url = `https://api.github.com/repos/oven-sh/WebKit/releases/tags/${tag}`;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const response = await fetch(url, {
  headers: { "User-Agent": "bun-build-system", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});
if (response.status === 404) fail(`oven-sh/WebKit has no release ${tag}. It is published once every build is done.`);
if (!response.ok) fail(`HTTP ${response.status} ${response.statusText} for ${url}`);

const { assets } = (await response.json()) as { assets: { name: string; state: string; digest: string | null }[] };
const lines = assets
  .filter(asset => /^bun-webkit-[\w-]+\.tar\.gz$/.test(asset.name))
  .sort((a, b) => (a.name < b.name ? -1 : 1))
  .map(({ name, state, digest }) => {
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(digest ?? "")?.[1];
    if (state !== "uploaded" || sha256 === undefined)
      fail(`${name} has no sha256 (state: ${state}, digest: ${digest})`);
    return `${sha256}  ${tag}/${name}\n`;
  });
if (lines.length === 0) fail(`${tag} has no tarballs`);

writeFileSync(webkitSha256Sums, lines.join(""));
console.log(`pinned ${lines.length} tarballs of ${tag}`);
