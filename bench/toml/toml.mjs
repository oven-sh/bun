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

// Names of mixed lengths, as in a config file.
const name = i => `${"dependency-name".slice(0, 3 + ((i * 5) % 13))}-${i}`;
const nonAsciiName = i => `"clé-${i}"`;

function lines(count, line) {
  let doc = "";
  for (let i = 0; i < count; i++) doc += line(i);
  return doc;
}

// One table of `count` keys, for each way a table can get its keys.
const shapes = {
  "keys": count => "[dependencies]\n" + lines(count, i => `${name(i)} = "1.${i}.0"\n`),
  "non-ASCII keys": count => "[dependencies]\n" + lines(count, i => `${nonAsciiName(i)} = "1.${i}.0"\n`),
  "dotted keys": count => "[dependencies]\n" + lines(count, i => `${name(i)}.version = "1.${i}.0"\n`),
  "table headers": count => lines(count, i => `[dependencies.${name(i)}]\nversion = "1.${i}.0"\n`),
  "keys of an inline table": count => `dependencies = { ${lines(count, i => `${name(i)} = "1.${i}.0", `)} }\n`,
};

const packages = count =>
  lines(count, i => `[[package]]\nname = "package-${i}"\nversion = "1.0.${i}"\nchecksum = "${i}"\n`);
const others = lines(100, i => `[${name(i)}]\n`);

const documents = [
  ["one key", "a = 1"],
  ["config", config],
  // A table is scanned for a key up to 64 keys, and indexed from 65.
  ...Object.entries(shapes).flatMap(([shape, document]) =>
    [16, 64, 65, 1024].map(count => [`${count} ${shape} in a table`, document(count)]),
  ),
  ["10,000 keys in a table", shapes.keys(10_000)],
  ["1,000 [[package]] tables of 3 keys", packages(1000)],
  // Each `[[package]]` header finds `package` among the 101 keys of the root table.
  ["1,000 [[package]] tables, `package` is the first of 101 root keys", packages(1) + others + packages(999)],
  ["1,000 [[package]] tables, `package` is the last of 101 root keys", others + packages(1000)],
];

for (const [title, doc] of documents) {
  group(`${title} (${sizeLabel(doc.length)})`, () => {
    if (isBun) bench("Bun.TOML.parse", () => Bun.TOML.parse(doc));
    bench("smol-toml", () => smolTomlParse(doc));
  });
}

await run();
