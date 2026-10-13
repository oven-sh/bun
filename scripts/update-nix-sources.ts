// Points nix/sources.json at a Bun release, using the checksums in that
// release's SHASUMS256.txt.
//
//   bun scripts/update-nix-sources.ts           # latest release
//   bun scripts/update-nix-sources.ts 1.4.3     # a specific version
import { dirname, join } from "node:path";

const sourcesPath = join(dirname(import.meta.dir), "nix", "sources.json");
const sources = await Bun.file(sourcesPath).json();

let version = process.argv[2]?.replace(/^bun-v/, "");
if (!version) {
  const res = await fetch("https://api.github.com/repos/oven-sh/bun/releases/latest");
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  version = ((await res.json()).tag_name as string).replace(/^bun-v/, "");
}

const shasumsUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt`;
const res = await fetch(shasumsUrl);
if (!res.ok) throw new Error(`${shasumsUrl} returned ${res.status}`);
const shasums = new Map<string, string>();
for (const line of (await res.text()).split("\n")) {
  if (!line.trim()) continue;
  // `<sha256>  <file>`, or `<sha256> *<file>` from `sha256sum --binary`.
  const match = line.trim().match(/^([0-9a-fA-F]{64}) [ *](\S+)$/);
  if (!match) throw new Error(`Unexpected line in ${shasumsUrl}: ${line}`);
  shasums.set(match[2], match[1].toLowerCase());
}

for (const [system, source] of Object.entries<{ asset: string; sha256: string }>(sources.sources)) {
  const sha256 = shasums.get(`${source.asset}.zip`);
  if (!sha256) throw new Error(`${source.asset}.zip (${system}) is missing from ${shasumsUrl}`);
  source.sha256 = sha256;
}
sources.version = version;

await Bun.write(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
console.log(`nix/sources.json -> bun ${version}`);
