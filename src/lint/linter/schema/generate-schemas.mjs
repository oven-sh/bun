// Generates `data.rs`: `meta.schema` and `meta.defaultOptions` of every rule of ESLint and
// typescript-eslint, as JSON.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> \
//   TYPESCRIPT_ESLINT_DIR=<built checkout of typescript-eslint> node generate-schemas.mjs [--check]
//
// `--check`: writes nothing, and fails if `data.rs` is not what would be written.
//
// Those of the rules of other plugins are taken from `meta` in test/cli/lint/conformance/fixtures/<plugin>, those of Bun's own
// rules from `own.json`.
//
// A subtree that occurs more than once is written once, in `SHARED`, and `{"$":<index>}` stands for it. A long list of strings
// is in `NAMES`, each as the number of bytes that it has in common with the one before it, the number of the others, and these;
// `{"$names":<index>}` stands for it.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

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
let bytes = 0;
const add = (id, rule) => {
  const { schema, defaultOptions } = rule.meta ?? {};
  if (schema === false) throw new Error(`${id}: schema: false`);
  const hasSchema = schema !== undefined && !(Array.isArray(schema) && schema.length === 0);
  if (!hasSchema && !defaultOptions?.length) return;
  // `validate_by_id` reads no schema for a rule that is given no options. This throws if the rule needs some.
  const rules = { r: { meta: { schema, defaultOptions }, create: () => ({}) } };
  const configs = new FlatConfigArray([{ plugins: { x: { rules } }, rules: { "x/r": 2 } }], { basePath: "/" });
  configs.normalizeSync();
  configs.getConfig("/a.js");
  const tree = [hasSchema ? strip(schema) : [], ...(defaultOptions?.length ? [defaultOptions] : [])];
  bytes += JSON.stringify(tree).length;
  rows.push([id, JSON.parse(JSON.stringify(tree))]);
};
for (const [name, rule] of requireFromEslint("./lib/rules")) add(name, rule);
for (const [name, rule] of Object.entries(requireFromPlugin("./dist/rules/index.js")))
  add(`@typescript-eslint/${name}`, rule);
const fixtures = join(import.meta.dirname, "../../../../test/cli/lint/conformance/fixtures");
for (const plugin of ["react-hooks", "import", "n", "oxc", "react"]) {
  if (!existsSync(join(fixtures, plugin))) continue;
  for (const file of readdirSync(join(fixtures, plugin), { recursive: true }).filter(it => it.endsWith(".json"))) {
    const { rule, meta } = JSON.parse(readFileSync(join(fixtures, plugin, file), "utf8"));
    add(`${plugin}/${rule}`, {
      meta: { schema: meta.schema ?? undefined, defaultOptions: meta.defaultOptions ?? undefined },
    });
  }
}
// Bun's own rules are of no package: their schemas are written here.
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

const map = (value, change) =>
  Array.isArray(value)
    ? value.map(change)
    : Object.fromEntries(Object.entries(value).map(([key, it]) => [key, change(it)]));
const isTree = value => value !== null && typeof value === "object";

const lists = [];
const coded = list => {
  const out = [];
  let previous = Buffer.alloc(0);
  for (const name of list) {
    const text = Buffer.from(name);
    let shared = 0;
    while (shared < Math.min(previous.length, text.length, 255) && previous[shared] === text[shared]) shared++;
    if (text.length - shared > 255) throw new Error(`too long: ${name}`);
    out.push(shared, text.length - shared, ...text.subarray(shared));
    previous = text;
  }
  return Buffer.from(out);
};
const withLists = value => {
  if (!isTree(value)) return value;
  if (Array.isArray(value) && value.length >= 16 && value.every(it => typeof it === "string")) {
    const list = coded(value);
    const known = lists.findIndex(it => it.equals(list));
    if (known >= 0) return { $names: known };
    // 16: the entry of the table.
    if (JSON.stringify(value).length - list.length > 16 + 60) return { $names: lists.push(list) - 1 };
  }
  return map(value, withLists);
};
let trees = rows.map(it => withLists(it[1]));

// The subtree whose replacement saves the most, again and again.
const shared = [];
for (;;) {
  const count = new Map();
  const walk = value => {
    if (!isTree(value) || "$" in value || "$names" in value) return;
    const text = JSON.stringify(value);
    count.set(text, (count.get(text) ?? 0) + 1);
    Object.values(value).forEach(walk);
  };
  trees.forEach(walk);
  shared.forEach(walk);
  const reference = `{"$":${shared.length}}`.length;
  let [best, most] = [null, 31];
  for (const [text, times] of count) {
    const saved = times * (text.length - reference) - text.length - 16;
    if (times > 1 && (saved > most || (saved === most && best !== null && text < best))) [best, most] = [text, saved];
  }
  if (best === null) break;
  const replace = value =>
    !isTree(value) ? value : JSON.stringify(value) === best ? { $: shared.length } : map(value, replace);
  trees = trees.map(replace);
  shared.forEach((it, i) => (shared[i] = replace(it)));
  shared.push(JSON.parse(best));
}
const quoted = tree => {
  const json = JSON.stringify(tree);
  if (json.includes('"##')) throw new Error(`cannot be quoted: ${json}`);
  return `r##"${json}"##`;
};
const literal = list =>
  `b"${[...list].map(it => (it >= 0x20 && it < 0x7f && it !== 0x22 && it !== 0x5c ? String.fromCharCode(it) : `\\x${it.toString(16).padStart(2, "0")}`)).join("")}"`;
const stored =
  [...trees, ...shared].reduce((sum, it) => sum + JSON.stringify(it).length, 0) +
  lists.reduce((sum, it) => sum + it.length, 0);

const text = `//! Generated by \`generate-schemas.mjs\` from eslint ${requireFromEslint("./package.json").version} and @typescript-eslint/eslint-plugin
//! ${requireFromPlugin("./package.json").version}. Not edited by hand.

/// Sorted by the name of the rule: \`[meta.schema]\` or \`[meta.schema, meta.defaultOptions]\` as JSON. A
/// rule that is not listed takes no options. \`{"$":n}\` stands for \`SHARED[n]\`, \`{"$names":n}\` for the strings of \`NAMES[n]\`.
#[rustfmt::skip]
pub(super) static SCHEMAS: &[(&str, &str)] = &[
${rows.map(([id], i) => `    ("${id}", ${quoted(trees[i])}),`).join("\n")}
];

/// What occurs more than once in the schemas, as JSON.
#[rustfmt::skip]
pub(super) static SHARED: &[&str] = &[
${shared.map(it => `    ${quoted(it)},`).join("\n")}
];

/// Lists of strings. Of each string: how many bytes it has in common with the one before it, how many follow these, and those
/// that follow.
#[rustfmt::skip]
pub(super) static NAMES: &[&[u8]] = &[
${lists.map(it => `    ${literal(it)},`).join("\n")}
];
`;
const path = join(import.meta.dirname, "data.rs");
if (!process.argv.includes("--check")) writeFileSync(path, text);
else if (readFileSync(path, "utf8") !== text) throw new Error("data.rs is not what this writes");
console.log(
  `${rows.length} rules, ${bytes} bytes, stored in ${stored}: ${shared.length} shared, ${lists.length} lists`,
);
