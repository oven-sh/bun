import { parse as smolTomlParse } from "smol-toml";
import { bench, group, run } from "../runner.mjs";

const isBun = typeof Bun !== "undefined" && Bun.TOML;

function sizeLabel(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

// -- documents --

const config = `
telemetry = false
logLevel = "warn"

[install]
exact = true
registry = "https://registry.npmjs.org"
saveTextLockfile = true
linker = "hoisted"

[install.scopes]
"@myorg" = { token = "$NPM_TOKEN", url = "https://npm.pkg.github.com/" }

[test]
preload = ["./setup.ts"]
coverage = false
coverageThreshold = 0.8
timeout = 5000

[run]
bun = true
silent = false

[define]
"process.env.FOO" = "'bar'"
`;

// One table of `count` keys. Keys of mixed lengths, as in a config file.
function table(count, key = i => `${"dependency-name".slice(0, 3 + ((i * 5) % 13))}-${i}`) {
  let doc = "[dependencies]\n";
  for (let i = 0; i < count; i++) doc += `${key(i)} = "1.${i}.0"\n`;
  return doc;
}

const nonAscii = i => `"clé-${i}"`;

function packages(count) {
  let doc = "";
  for (let i = 0; i < count; i++)
    doc += `[[package]]\nname = "package-${i}"\nversion = "1.0.${i}"\nchecksum = "${i}"\n`;
  return doc;
}

const documents = [
  ["one key", "a = 1"],
  ["config", config],
  // A table is scanned for a key up to 64 keys, and indexed from 65.
  ...[16, 64, 65, 128, 1024].map(count => [`a table of ${count} keys`, table(count)]),
  ...[64, 65, 1024].map(count => [`a table of ${count} non-ASCII keys`, table(count, nonAscii)]),
  ["1,000 tables of 3 keys", packages(1000)],
  ["a table of 10,000 keys", table(10_000)],
];

for (const [name, doc] of documents) {
  group(`${name} (${sizeLabel(doc.length)})`, () => {
    if (isBun) bench("Bun.TOML.parse", () => Bun.TOML.parse(doc));
    bench("smol-toml", () => smolTomlParse(doc));
  });
}

await run();
