// Writes `known_css_properties.rs`: the CSS properties `svelte/no-unknown-style-directive-property` knows, from the
// `known-css-properties` package that eslint-plugin-svelte imports.
//
//   bun src/lint/svelte/known-css-properties.ts <node_modules with known-css-properties>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [modules] = process.argv.slice(2);
if (!modules) {
  console.error("usage: bun known-css-properties.ts <node_modules>");
  process.exit(1);
}
const root = join(modules, "known-css-properties");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { properties } = JSON.parse(readFileSync(join(root, "data/all.json"), "utf8")) as { properties: string[] };
const sorted = [...new Set(properties)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const out = `//! \`all\` of known-css-properties ${version} (\`data/all.json\`), sorted. Written by \`known-css-properties.ts\`.
//! - https://github.com/known-css/known-css-properties (Copyright (c) 2017 Mavrix Technologies, MIT License)

pub(crate) const ALL: &[&str] = &[
${sorted.map(it => `    ${JSON.stringify(it)},`).join("\n")}
];
`;
writeFileSync(join(import.meta.dir, "known_css_properties.rs"), out);
console.log(`${sorted.length} properties of known-css-properties ${version}`);
