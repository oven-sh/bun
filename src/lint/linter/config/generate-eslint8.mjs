// Generates `eslint8.rs`: what the last ESLint that reads `.eslintrc.*` has that today's ESLint, which the built-in
// rules are ports of, lacks or does differently.
//
//   ESLINT_8_DIR=<node_modules/eslint of 8.57.1> ESLINT_9_DIR=<.. of 9.39.5> ESLINT_DIR=<.. of today> node generate-eslint8.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const requireFrom8 = createRequire(join(resolve(process.env.ESLINT_8_DIR), "package.json"));
const requireFrom9 = createRequire(join(resolve(process.env.ESLINT_9_DIR), "package.json"));
const requireFromToday = createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"));
const rules8 = new Map(requireFrom8("./lib/rules"));
const rules9 = new Map(requireFrom9("./lib/rules"));
const rulesToday = new Map(requireFromToday("./lib/rules"));
const configs8 = requireFrom8("@eslint/js").configs;
const configs9 = requireFrom9("@eslint/js").configs;
const { environments } = requireFrom8("@eslint/eslintrc").Legacy;

const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const quoted = text => {
  if (text.includes('"##')) throw new Error(`cannot be quoted: ${text}`);
  return `r##"${text}"##`;
};

const flags = (name, rule, configs) =>
  rule === undefined
    ? "ABSENT"
    : [
        name in configs.recommended.rules && "RECOMMENDED",
        name in configs.all.rules && "ALL",
        rule.meta.fixable && "FIXABLE",
        rule.meta.hasSuggestions && "SUGGESTS",
      ]
        .filter(Boolean)
        .join(" | ") || "0";
for (const [configs, rules] of [
  [configs8, rules8],
  [configs9, rules9],
])
  for (const [name, severity] of Object.entries({ ...configs.recommended.rules, ...configs.all.rules }))
    if (severity !== "error" || !rules.has(name)) throw new Error(`${name}: ${severity}`);
// These are in ../deprecated_data.rs. ESLint 8 has all of them too.
const isAboutLayout = name => {
  const replacedBy = rulesToday.get(name)?.meta.deprecated?.replacedBy ?? [];
  return replacedBy.length > 0 && replacedBy.every(it => it.plugin?.name === "@stylistic/eslint-plugin");
};
for (const name of rulesToday.keys()) if (isAboutLayout(name) && !rules8.has(name)) throw new Error(name);
const names = [...new Set([...rules8.keys(), ...rules9.keys()])].filter(name => !isAboutLayout(name)).sort(byBytes);

// Same as in ../schema/generate-schemas.mjs.
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
const schemaOf = rule => JSON.stringify(strip(rule?.meta.schema ?? []));
// `[name, schema, the last major version that has it]`
const schemas = [];
for (const name of names) {
  const [in8, in9] = [rules8, rules9].map(rules => (rules.has(name) ? schemaOf(rules.get(name)) : undefined));
  const today = schemaOf(rulesToday.get(name));
  if (in8 === today && in9 !== undefined && in9 !== today) throw new Error(name);
  if (in8 !== undefined && in8 !== today && in8 !== in9) schemas.push([name, in8, 8]);
  if (in9 !== undefined && in9 !== today) schemas.push([name, in9, 9]);
}

// Messages whose id has changed since.
const renamed = { "no-implicit-coercion": { implicitCoercion: "useRecommendation" } };
const placeholders = text => [...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/gu)].map(it => it[1]).sort();
// Messages that had no placeholders.
const plain = { "no-useless-assignment": ["unnecessaryAssignment"] };
// `[id, text]` of today's message `id` in the rule of an earlier version, if it's to be used in its place.
const messageBefore = (rule, name, id, text) => {
  const before = rule?.meta.messages ?? {};
  const idBefore = id in before ? id : (renamed[name]?.[id] ?? id);
  // Today's message under the old id of a renamed message is only a suggestion.
  if (!(idBefore in before) || before[idBefore] === text || Object.values(renamed[name] ?? {}).includes(id)) return;
  // If the placeholders differ, the data for them differs too, so the old text can't be filled in.
  const isSame = String(placeholders(before[idBefore])) === String(placeholders(text));
  if (isSame || plain[name]?.includes(id)) return [idBefore, before[idBefore]];
};
const messages = [];
for (const name of names) {
  for (const [id, text] of Object.entries(rulesToday.get(name)?.meta.messages ?? {})) {
    const [in8, in9] = [rules8, rules9].map(rules => messageBefore(rules.get(name), name, id, text));
    // A row for ESLint 9 is used for ESLint 8 too.
    if (in9 && !in8 && rules8.has(name)) throw new Error(`${name}: ${id}`);
    if (in8 && String(in8) !== String(in9)) messages.push([name, id, ...in8, 8]);
    if (in9) messages.push([name, id, ...in9, 9]);
  }
}

const bytes = schemas.reduce((sum, it) => sum + it[1].length, 0);
writeFileSync(
  join(import.meta.dirname, "eslint8.rs"),
  `//! Generated by \`generate-eslint8.mjs\` from eslint ${requireFrom8("./package.json").version} and ${requireFrom9("./package.json").version}, compared with eslint ${requireFromToday("./package.json").version}. Not edited by hand.
//!
//! What \`eslint:recommended\` and \`eslint:all\` mean in ESLint 8's config files, which ESLint 9 reads too, which rules
//! and environments exist for them, and the rules' messages and schemas where they have changed since.

use crate::linter::registry::formatting_rule;
use crate::options::Json;
use crate::rule::{Message, Meta, Plugin};

/// The rule is in \`eslint:recommended\`.
pub(super) const RECOMMENDED: u8 = 1;
/// The rule is in \`eslint:all\`.
pub(super) const ALL: u8 = 2;
/// \`meta.fixable\`
const FIXABLE: u8 = 4;
/// \`meta.hasSuggestions\`
const SUGGESTS: u8 = 8;
/// That version doesn't have the rule.
const ABSENT: u8 = 16;

/// All rules except [the layout rules that are deprecated today](formatting_rule), sorted by name, each with its flags in
/// ESLint 8 and in ESLint 9.
#[rustfmt::skip]
static RULES: [(&str, u8, u8); ${names.length}] = [
${names.map(name => `    ("${name}", ${flags(name, rules8.get(name), configs8)}, ${flags(name, rules9.get(name), configs9)}),`).join("\n")}
];

/// The built-in environments, sorted by name.
#[rustfmt::skip]
static ENVIRONMENTS: [&str; ${environments.size}] = [
${[...environments.keys()]
  .sort(byBytes)
  .map(name => `    "${name}",`)
  .join("\n")}
];

/// The rule, a message's id in today's rule, that message in an earlier ESLint, and the last major version that has it.
#[rustfmt::skip]
static MESSAGES: [(&str, &str, Message, u8); ${messages.length}] = [
${messages.map(([name, id, idBefore, text, last]) => `    ("${name}", "${id}", Message::new("${idBefore}", ${quoted(text)}), ${last}),`).join("\n")}
];

/// \`meta.schema\` as JSON, where it differs from \`schema::data\`, and the last major version that has it. Sorted by rule name.
#[rustfmt::skip]
static SCHEMAS: [(&str, &str, u8); ${schemas.length}] = [
${schemas.map(([name, schema, last]) => `    ("${name}", ${quoted(schema)}, ${last}),`).join("\n")}
];

/// In all of these, \`major\` is 8 or 9.
fn flags_of(name: &[u8], major: u8) -> Option<u8> {
    let at = RULES.binary_search_by(|it| it.0.as_bytes().cmp(name));
    let rule = RULES.get(at.ok()?)?;
    Some(if major == 8 { rule.1 } else { rule.2 }).filter(|it| *it != ABSENT)
}

/// True if ESLint \`major\` has a rule named \`name\`.
pub(super) fn has_rule(name: &[u8], major: u8) -> bool {
    flags_of(name, major).is_some() || formatting_rule(name).is_some()
}

/// The names of the rules with \`flag\`, which is [\`RECOMMENDED\`] or [\`ALL\`].
pub(super) fn rules_with(flag: u8, major: u8) -> impl Iterator<Item = &'static str> {
    RULES
        .iter()
        .filter(move |it| (if major == 8 { it.1 } else { it.2 }) & flag != 0)
        .map(|it| it.0)
}

/// True if there's an environment named \`name\`.
pub(super) fn has_environment(name: &[u8]) -> bool {
    ENVIRONMENTS
        .binary_search_by(|it| it.as_bytes().cmp(name))
        .is_ok()
}

/// The \`meta.schema\` of the rule named \`name\`, if it differs from today's.
pub(super) fn schema_of(name: &[u8], major: u8) -> Option<Json> {
    let from = SCHEMAS.partition_point(|it| it.0.as_bytes() < name);
    let mut of_rule = (SCHEMAS.get(from..)?.iter()).take_while(|it| it.0.as_bytes() == name);
    crate::json::parse(of_rule.find(|it| major <= it.2)?.1.as_bytes())
}

/// The rule \`meta\`'s \`message\` in ESLint \`major\`.
pub(crate) fn message_of(meta: &Meta, message: Message, major: u8) -> Message {
    let mut all = MESSAGES.iter().filter(|_| meta.plugin == Plugin::Eslint);
    all.find(|it| it.0 == meta.name && it.1 == message.id && major <= it.3)
        .map_or(message, |it| it.2)
}

/// Returns whether the rule \`meta\` has fixes, and whether it has suggestions, in ESLint \`major\`.
pub(crate) fn changes_of(meta: &Meta, major: u8) -> (bool, bool) {
    let flags = match meta.plugin {
        Plugin::Eslint => flags_of(meta.name.as_bytes(), major),
        _ => None,
    };
    flags.map_or((true, true), |it| (it & FIXABLE != 0, it & SUGGESTS != 0))
}
`,
);
console.log(
  `${names.length} rules, ${environments.size} environments, ${messages.length} messages, ${schemas.length} schemas of ${bytes} bytes`,
);
