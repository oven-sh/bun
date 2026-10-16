// Generates `schemas.txt` and `data.rs`: `meta.schema` and `meta.defaultOptions` of every ESLint and typescript-eslint rule
// that Bun has, as JSON.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> \
//   TYPESCRIPT_ESLINT_DIR=<built checkout of typescript-eslint> node generate-schemas.mjs [--check]
//
// `--check` writes nothing, and fails if either file differs from what would be written.
//
// Schemas for other plugins' rules come from the `meta` in the fixtures in test/cli/lint/conformance/bundle.zst, which is what
// the published packages have. `plugins.json` has the rules without fixtures, and wins over the fixtures. `own.json` has Bun's
// own rules and eslint-plugin-prettier's one rule.
//
// Nothing is deduplicated here. The executable embeds `schemas.txt` compressed, which takes care of the repetition.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const requireFromEslint = createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"));
const requireFromPlugin = createRequire(
  join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"),
);

/** Without what does not matter for validating. */
const strip = (schema, isMap = false) => {
  if (Array.isArray(schema)) return schema.map(it => strip(it));
  if (schema === null || typeof schema !== "object") return schema;
  const maps = ["properties", "patternProperties", "definitions", "$defs"];
  const values = ["enum", "const", "default", "required"];
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => isMap || !["description", "title", "$schema", "examples"].includes(key))
      .map(([key, value]) => [
        key,
        !isMap && values.includes(key) ? value : strip(value, !isMap && maps.includes(key)),
      ]),
  );
};

const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const rows = [];
const needOptions = [];
const add = (id, rule) => {
  const { schema, defaultOptions } = rule.meta ?? {};
  if (schema === false) throw new Error(`${id}: schema: false`);
  const hasSchema = schema !== undefined && !(Array.isArray(schema) && schema.length === 0);
  if (!hasSchema && !defaultOptions?.length) return;
  // `validate_by_id` reads no schema for a rule that is given no options, unless the rule needs some: then this throws.
  const rules = { r: { meta: { schema, defaultOptions }, create: () => ({}) } };
  const configs = new FlatConfigArray([{ plugins: { x: { rules } }, rules: { "x/r": 2 } }], { basePath: "/" });
  configs.normalizeSync();
  try {
    configs.getConfig("/a.js");
  } catch {
    needOptions.push(id);
  }
  // typescript-eslint merges a rule's `defaultOptions` inside the rule, so ESLint never sees them. They go in a third slot,
  // which only `bun lint --rules -f json` reads. In the second slot they'd be validated together with the user's options.
  const merged = defaultOptions?.length
    ? [defaultOptions]
    : rule.defaultOptions?.length
      ? [[], rule.defaultOptions]
      : [];
  rows.push([id, [hasSchema ? strip(schema) : [], ...merged]]);
};
// Those are not here: ../deprecated_data.rs.
const isAboutLayout = ({ meta }) => {
  const replacedBy = meta.deprecated?.replacedBy ?? [];
  return replacedBy.length > 0 && replacedBy.every(it => it.plugin?.name === "@stylistic/eslint-plugin");
};
for (const [name, rule] of requireFromEslint("./lib/rules")) if (!isAboutLayout(rule)) add(name, rule);
for (const [name, rule] of Object.entries(requireFromPlugin("./dist/rules/index.js")))
  add(`@typescript-eslint/${name}`, rule);
const ofPlugins = JSON.parse(readFileSync(join(import.meta.dirname, "plugins.json"), "utf8"));
// `=== /<path> <length in bytes>\n`, the bytes, `\n`
const fixtures = join(import.meta.dirname, "../../../../test/cli/lint/conformance/bundle.zst");
const bundle = zstdDecompressSync(readFileSync(fixtures));
let at = 0;
while (at < bundle.length) {
  const end = bundle.indexOf(10, at);
  const [, path, length] = /^=== \/(.*) (\d+)$/.exec(bundle.toString("utf8", at, end));
  const [, id] = /^((?:import|n|oxc|react|react-hooks)\/.*)\.json$/.exec(path) ?? [];
  if (id !== undefined && !(id in ofPlugins)) {
    const { schema, defaultOptions } = JSON.parse(bundle.toString("utf8", end + 1, end + 1 + Number(length))).meta;
    // What a rule does not have is `null` there.
    ofPlugins[id] = { schema: schema ?? undefined, defaultOptions: defaultOptions ?? undefined };
  }
  at = end + 1 + Number(length) + 1;
}
for (const [id, meta] of Object.entries(ofPlugins)) add(id, { meta });
// Bun's own rules are of no package: their schemas are written here. So is that of `prettier/prettier`, which has no fixtures there.
for (const [id, schema] of Object.entries(JSON.parse(readFileSync(join(import.meta.dirname, "own.json"), "utf8"))))
  add(id, { meta: { schema } });
// The rules of the React Compiler in eslint-plugin-react-hooks, which have no fixtures there.
for (const rule of [
  "capitalized-calls",
  "config",
  "error-boundaries",
  "exhaustive-effect-dependencies",
  "fbt",
  "gating",
  "globals",
  "hooks",
  "immutability",
  "incompatible-library",
  "invariant",
  "memo-dependencies",
  "memoized-effect-dependencies",
  "no-deriving-state-in-effects",
  "preserve-manual-memoization",
  "purity",
  "refs",
  "rule-suppression",
  "set-state-in-effect",
  "set-state-in-render",
  "static-components",
  "syntax",
  "todo",
  "unsupported-syntax",
  "use-memo",
  "void-use-memo",
])
  add(`react-hooks/${rule}`, { meta: { schema: [{ type: "object", additionalProperties: true }] } });
rows.sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

// One `id<tab>JSON` line per rule.
const schemas = rows.map(([id, tree]) => `${id}\t${JSON.stringify(tree)}\n`).join("");
const data = `//! Generated by \`generate-schemas.mjs\` from eslint ${requireFromEslint("./package.json").version} and @typescript-eslint/eslint-plugin
//! ${requireFromPlugin("./package.json").version}, together with \`schemas.txt\`. Not edited by hand.

/// The rules that cannot be without options. Sorted.
pub(super) static NEED_OPTIONS: &[&str] = &[${needOptions
  .sort()
  .map(it => `"${it}"`)
  .join(", ")}];
`;
for (const [name, text] of [
  ["schemas.txt", schemas],
  ["data.rs", data],
]) {
  const path = join(import.meta.dirname, name);
  if (!process.argv.includes("--check")) writeFileSync(path, text);
  else if (readFileSync(path, "utf8") !== text) throw new Error(`${name} is not what this writes`);
}
console.log(`${rows.length} rules, ${Buffer.byteLength(schemas)} bytes`);
