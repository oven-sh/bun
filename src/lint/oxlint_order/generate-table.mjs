// Generates `table.rs`: when oxlint calls each of its rules, and with which node kinds.
//
//   OXC_DIR=<checkout of oxc> OXLINT=<the oxlint executable> node generate-table.mjs
//
// Everything comes from files that oxc generates for itself: `rule_runner_impls.rs` has every rule's `NODE_TYPES` and
// `RUN_FUNCTIONS`, and `rules_enum.rs` has the rules in number order. The executable is only used to get the version.
// `OXLINT_VERSION` can be set instead.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const generated = join(resolve(process.env.OXC_DIR), "crates/oxc_linter/src/generated");
const version = process.env.OXLINT
  ? /[\d.]+/.exec(execFileSync(resolve(process.env.OXLINT), ["--version"]).toString())[0]
  : process.env.OXLINT_VERSION;
if (!version) throw new Error("OXLINT or OXLINT_VERSION");

// The plugins that are at least partly built in, keyed by oxc's directory names.
const plugins = {
  import: "Import",
  eslint: "Eslint",
  typescript: "TypeScript",
  jest: "Jest",
  react: "React",
  react_perf: "ReactPerf",
  unicorn: "Unicorn",
  jsx_a11y: "JsxA11y",
  oxc: "Oxc",
  nextjs: "Nextjs",
  promise: "Promise",
  vitest: "Vitest",
  node: "Node",
};
const notBuiltIn = ["jsdoc", "vue"];
// oxlint has these in `react`. Bun also lets you configure them under their own plugin's name.
const reactHooksRules = ["exhaustive-deps", "rules-of-hooks"];
// The rules that have both `run_once` and `run`, and which of the two reports what Bun's rule reports. Each was
// verified.
const both = {
  "eslint/no-irregular-whitespace": "Once",
  "eslint/no-restricted-imports": "Once",
  "import/extensions": "Once",
  "jest/no-jasmine-globals": "Once",
  "unicorn/prefer-number-properties": "Once",
};

const kebab = module => module.split("::")[0].replaceAll("_", "-");
const rules = [];
const impls = readFileSync(join(generated, "rule_runner_impls.rs"), "utf8");
for (const [, plugin, module, body] of impls.matchAll(
  /impl RuleRunner\s+for\s+crate::rules::(\w+)::([\w:]+)::\w+\s*\{(.*?)\n\}/gs,
)) {
  const types = /NODE_TYPES: Option<&AstTypesBitset> =\s*(None|Some\(.*?\));/s.exec(body)[1];
  const kinds = types === "None" ? undefined : [...types.matchAll(/AstType::(\w+)/g)].map(it => it[1]).sort();
  const runs = /RuleRunFunctionsImplemented::(\w+)/.exec(body)[1];
  const name = kebab(module);
  if (notBuiltIn.includes(plugin)) continue;
  if (!plugins[plugin]) throw new Error(`a new plugin: ${plugin}`);
  const when =
    { RunOnce: "Once", Run: "Entering", RunOnJestNode: "AtTheEnd" }[runs] ??
    // tsgolint runs the rules that need types.
    (kinds ? both[`${plugin}/${name}`] : "Last");
  if (!when) throw new Error(`${plugin}/${name} has several functions: see \`both\``);
  if (when === "Entering" && !kinds) throw new Error(`${plugin}/${name} is called with every node`);
  const isCalledWithNodes = when === "Entering" || `${plugin}/${name}` in both;
  rules.push({ plugin, name, when, kinds: isCalledWithNodes ? kinds : [] });
}

// The table doesn't store rule numbers. It's sorted by plugin and name when it's read, which has to match oxlint's
// order.
const enumeration = readFileSync(join(generated, "rules_enum.rs"), "utf8");
const aliases = Object.fromEntries(
  [...enumeration.matchAll(/pub use crate::rules::(\w+)::([\w:]+)::\w+ as (\w+);/g)].map(it => [
    it[3],
    `${it[1]}/${kebab(it[2])}`,
  ]),
);
const variants = /pub enum RuleEnum \{(.*?)\n\}/s.exec(enumeration)[1];
const numbered = [...variants.matchAll(/^\s+(\w+)\(/gm)].map(it => aliases[it[1]]);
const order = Object.keys(plugins);
const mine = numbered.filter(it => order.includes(it.split("/")[0]));
const sorted = mine.toSorted((a, b) => {
  const [[p, m], [q, n]] = [a.split("/"), b.split("/")];
  return order.indexOf(p) - order.indexOf(q) || (m < n ? -1 : 1);
});
if (mine.join() !== sorted.join()) throw new Error("the rules are not numbered by the plugin and the name");
if (mine.length !== rules.length) throw new Error(`${mine.length} rules have a number, ${rules.length} a runner`);

const kinds = [...new Set(rules.flatMap(it => it.kinds))].sort();
// The two highest byte values are reserved (`NONE` and `ASK` in `visited.rs`).
if (kinds.length > 253) throw new Error("a kind does not fit in a byte");

const lines = (words, indent, width = 118) => {
  const all = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + line.length + word.length + 4 > width) {
      all.push(line);
      line = "";
    }
    line += `${word} `;
  }
  all.push(line.trimEnd());
  return all;
};
// A Rust string literal with `words` separated by spaces, split over as many lines as needed. `indent` is the
// indentation of the line it starts on.
const text = (words, indent) => {
  const all = lines(words, `${indent}    `);
  return all.length === 1
    ? `"${all[0]}"`
    : `concat!(\n${all.map(it => `${indent}    "${it}",`).join("\n")}\n${indent})`;
};
const whens = ["Once", "Entering", "AtTheEnd", "Last"];
// The words for one plugin's rules that report at the same time. Rules called with the same kinds are grouped together.
const words = list => {
  const groups = new Map();
  for (const it of list) {
    const key = it.kinds.map(kind => String(kinds.indexOf(kind)).padStart(3, "0")).join(" ");
    if (!groups.has(key)) groups.set(key, { kinds: it.kinds, names: [] });
    groups.get(key).names.push(it.name);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([, it]) => [
      ...(it.kinds.length ? [it.kinds.map(kind => kinds.indexOf(kind)).join()] : []),
      ...it.names.sort(),
    ]);
};
const group = (plugin, list) =>
  whens
    .filter(when => list.some(it => it.when === when))
    .map(when => {
      return `    (Plugin::${plugin}, ${when}, ${text(words(list.filter(it => it.when === when)), "    ")}),`;
    })
    .join("\n");
const tables = Object.entries(plugins).map(([directory, plugin]) =>
  group(
    plugin,
    rules.filter(it => it.plugin === directory),
  ),
);
tables.push(
  group(
    "ReactHooks",
    rules.filter(it => it.plugin === "react" && reactHooksRules.includes(it.name)),
  ),
);

writeFileSync(
  join(import.meta.dirname, "table.rs"),
  `//! Generated by \`generate-table.mjs\` from oxlint ${version}. Not edited by hand.

use crate::rule::Plugin;
use crate::rule::When::{self, AtTheEnd, Entering, Last, Once};

/// The node kinds that at least one oxlint rule is called with, under oxc's names (\`AstType\`), sorted and separated
/// by spaces.
#[rustfmt::skip]
pub(super) static KINDS: &str = ${text(kinds, "")};

/// The plugins in oxlint's order. Each plugin's rules are grouped by when they report: \`run_once\` ([\`Once\`]),
/// \`run\` ([\`Entering\`]), \`run_on_jest_node\` ([\`AtTheEnd\`]) or tsgolint ([\`Last\`]). The names are separated by
/// spaces. Before each group of \`run\` rules are the node kinds they're called with (\`NODE_TYPES\`), as
/// comma-separated indices into [\`KINDS\`].
#[rustfmt::skip]
pub(super) static RULES: &[(Plugin, When, &str)] = &[
${tables.join("\n")}
];
`,
);
