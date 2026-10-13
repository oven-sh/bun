// Generates `oxlint_fields.rs`: what the options of oxlint's rules look like, for `oxlint_options.rs`, which refuses what oxlint
// refuses.
//
//   OXLINT=<the oxlint executable> SCHEMA=<configuration_schema.json of its package> node generate-oxlint-fields.mjs
//
// The executable is the judge. Each rule is given one odd value after the other, at every place of its options, and what it
// answers says what it expects there: "invalid type: integer `1`, expected a boolean", "unknown field `zz`, expected one of ..".
// The schema only says which rules there are and where to look further. Inside an untagged enum, where every answer is the same,
// it also says what the parts are, and the executable is asked whether that is so.
//
// The notation. A row is a letter for how the rule reads its options, and a type:
//
//   f  the first option   F  the same, and nothing is said about what was received   S  the second
//   w  all of them        W  the same, and nothing is said about what was received
//   P  no-restricted-properties   E  one of two, or both       L, U  rules that read by hand
//
//   *  anything     b  bool       T F  only that bool   _  null    s  string   c  char   f  f64
//   n0 .. n6        u8 u16 u32 u64 usize i32 i64        r"a""b"    a pattern of Rust's regex, between `a` and `b`
//   ?t  Option      [t]"e"  Vec   {t}"e"  map: `e` is what is expected, if not "a sequence" or "a map"
//   <a,b>  an enum  <a,b>"e"  a string that is one of these, or else the text `e` with the string for `$`
//   #tt;   a tuple  |Name tt;  |"e"tt;  an untagged enum   /tt;  the first that fits, or the words of the last
//   %"e"tt;  by the kind of the value   !"e"t  `true` fits and is refused   Q  memberSyntaxSortOrder   =1;  the row `=1`
//   +tt  the first, and then the second   R2,3"e"  a number that is not from 2 to 3 is refused with `e`
//   J"e"  the strings in a list are names of functions, of which Jest's rules make patterns. `e` is before what is wrong with one
//   A  a severity that is not that of a rule, which only `shape.rs` writes
//   (Name~!^ field!^@$:t ..)  a struct. `&` in the name is the rule in Pascal case. `~` it ignores unknown fields, `!` from a
//   sequence it needs every field, `^` another struct is flattened into it. A field: `!` required, `^` of the flattened struct,
//   `+` a sequence needs it, `@` another name of the field before it, `$` of the one after it, `@@` of the one before that.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const oxlint = resolve(process.env.OXLINT);
const schema = JSON.parse(readFileSync(resolve(process.env.SCHEMA), "utf8"));
const version = /[\d.]+/.exec(execFileSync(oxlint, ["--version"]).toString())[0];
const rules = schema.definitions.DummyRuleMap.properties;
const plugins = [...new Set(Object.keys(rules).flatMap(it => (it.includes("/") ? [it.split("/")[0]] : [])))];
const scratch = mkdtempSync(join(tmpdir(), "oxlint-fields-"));

// ---------------------------------------------------------------------------------------------------------------------------
// Asking. Every rule is worked out by an async function of its own. One run of oxlint answers one question of each.

const pending = new Map();
const answered = new Map();

/** What oxlint says against `options` of `rule`: the lines below "Invalid configuration for rule". `null`: it takes them. */
function probe(rule, options) {
  const key = `${rule} ${JSON.stringify(options)}`;
  if (answered.has(key)) return Promise.resolve(answered.get(key));
  return new Promise(resolve => {
    if (!pending.has(rule)) pending.set(rule, []);
    pending.get(rule).push({ options, key, resolve });
  });
}

function run(slot, settings) {
  const directory = join(scratch, String(slot));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "a.js"), "");
  writeFileSync(
    join(directory, "c.json"),
    JSON.stringify({ plugins, categories: { correctness: "off" }, rules: settings }),
  );
  return new Promise(resolve => {
    const child = spawn(oxlint, ["-c", "c.json", "--disable-nested-config", "--threads=1", "a.js"], {
      cwd: directory,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let text = "";
    child.stdout.on("data", it => (text += it));
    child.stderr.on("data", it => (text += it));
    child.on("close", status => resolve({ text, status }));
  });
}

function refusalsIn(text) {
  const all = new Map();
  for (const block of text.split(/\n\n/)) {
    const found = /^\s*x Invalid configuration for rule `([^`]+)`:\n([\s\S]*)$/.exec(block);
    if (!found) continue;
    // It calls two plugins otherwise than the schema does.
    const rule = found[1].replace(/^(jsx|react)_(a11y|perf)\//, "$1-$2/");
    const lines = found[2].split("\n").map(line => line.replace(/^  \| ?/, ""));
    // It breaks a very long line.
    all.set(rule, lines.join("\n").replace(/\n+$/, "").replace(/,\n`/g, ", `"));
  }
  return all;
}

async function drive(tasks, width = 32) {
  let isDone = false;
  const all = Promise.all(tasks).then(() => (isDone = true));
  while (!isDone) {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const batches = [];
    for (const [rule, list] of pending) {
      list.splice(0, width).forEach((it, slot) => (batches[slot] ??= []).push([rule, it]));
      if (list.length === 0) pending.delete(rule);
    }
    await Promise.all(
      batches.map(async (batch, slot) => {
        const settings = Object.fromEntries(batch.map(([rule, it]) => [rule, ["error", ...it.options]]));
        const { text, status } = await run(slot, settings);
        if (status !== 0 && status !== 1) throw new Error(`oxlint: ${status}: ${text}`);
        const refusals = refusalsIn(text);
        for (const [rule, it] of batch) {
          answered.set(it.key, refusals.get(rule) ?? null);
          it.resolve(answered.get(it.key));
        }
      }),
    );
  }
  await all;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The notation

const INTEGERS = [
  ["u8", 0, 255],
  ["u16", 0, 65535],
  ["u32", 0, 4294967295],
  ["u64", 0, 2 ** 64],
  ["usize", 0, 2 ** 64],
  ["i32", -2147483648, 2147483647],
  ["i64", -(2 ** 63), 2 ** 63],
];
const quoted = text => `"${text.replace(/["\\]/g, "\\$&")}"`;
const partsOf = t => [t.t, ...(t.items ?? []), ...(t.alts ?? []), ...(t.fields ?? []).map(it => it.t)].filter(Boolean);

function write(t) {
  switch (t.k) {
    case "any":
      return "*";
    case "text":
      return t.text;
    case "bool":
      return "b";
    case "only":
      return t.value ? "T" : "F";
    case "null":
      return "_";
    case "str":
      return "s";
    case "char":
      return "c";
    case "float":
      return "f";
    case "int":
      return `n${INTEGERS.findIndex(it => it[0] === t.name)}`;
    case "regex":
      return "r" + (t.before || t.behind ? quoted(t.before ?? "") : "") + (t.behind ? quoted(t.behind) : "");
    case "opt":
      return `?${write(t.t)}`;
    case "seq":
      return `[${write(t.t)}]${t.expected ? quoted(t.expected) : ""}`;
    case "map":
      return `{${write(t.t)}}${t.expected ? quoted(t.expected) : ""}`;
    case "enum":
      return `<${t.variants.join(",")}>`;
    case "tuple":
      return `#${t.items.map(write).join("")};`;
    case "untagged":
      return `|${t.name} ${t.alts.map(write).join("")};`;
    case "oneOf":
      return `/${t.alts.map(write).join("")};`;
    case "struct": {
      const flags = (t.isOpen ? "~" : "") + (t.hasNoDefaults ? "!" : "") + (t.hasFlattened ? "^" : "");
      const field = it =>
        ` ${it.name}${it.isRequired ? "!" : ""}${it.isFlattened ? "^" : ""}${it.isNeeded ? "+" : ""}${it.alias ?? ""}:${write(it.t)}`;
      return `(${t.name}${flags}${t.fields.map(field).join("")})`;
    }
    default:
      throw new Error(`write: ${t.k}`);
  }
}

const isInteger = v => Number.isInteger(v) && !Object.is(v, -0);
const isMap = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether `v` is a `t`, for what is in an untagged enum. */
function fits(t, v) {
  switch (t.k) {
    case "any":
      return true;
    case "bool":
      return typeof v === "boolean";
    case "only":
      return v === t.value;
    case "null":
      return v === null;
    case "str":
      return typeof v === "string";
    case "float":
      return typeof v === "number";
    case "int":
      return isInteger(v) && v >= t.min && v <= t.max;
    case "opt":
      return v === null || fits(t.t, v);
    case "seq":
      return Array.isArray(v) && v.every(it => fits(t.t, it));
    case "map":
      return isMap(v) && Object.values(v).every(it => fits(t.t, it));
    case "enum":
      if (isMap(v))
        return Object.keys(v).length === 1 && t.variants.includes(Object.keys(v)[0]) && Object.values(v)[0] === null;
      return t.variants.includes(v);
    case "tuple":
      return Array.isArray(v) && v.length <= t.items.length && v.every((it, at) => fits(t.items[at], it));
    case "untagged":
      return t.alts.some(it => fits(it, v));
    case "struct":
      if (Array.isArray(v)) {
        if (t.hasFlattened) return false;
        if (v.length > t.fields.length || (t.hasNoDefaults && v.length < t.fields.length)) return false;
        return v.every((it, at) => fits(t.fields[at].t, it));
      }
      if (!isMap(v)) return false;
      for (const [key, it] of Object.entries(v)) {
        const field = t.fields.find(field => field.name === key);
        if (field ? !fits(field.t, it) : !t.isOpen) return false;
      }
      return t.fields.every(it => !it.isRequired || it.name in v);
    default:
      throw new Error(`fits: ${t.k}`);
  }
}

/** A value that is a `t`. */
function sampleOf(t) {
  switch (t.k) {
    case "bool":
      return true;
    case "only":
      return t.value;
    case "str":
    case "regex":
    case "char":
      return "x";
    case "int":
    case "float":
      return 1;
    case "enum":
      return t.variants[0];
    case "seq":
    case "tuple":
      return [];
    case "map":
      return {};
    case "opt":
      return sampleOf(t.t);
    case "struct":
      return Object.fromEntries(t.fields.filter(it => it.isRequired).map(it => [it.name, sampleOf(it.t)]));
    case "untagged":
    case "oneOf":
      return sampleOf(t.alts[0]);
    case "text":
      return t.sample;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The schema

const nameOf = it => (it?.$ref ?? it?.allOf?.[0]?.$ref)?.split("/").at(-1);
const deref = it =>
  it?.$ref ? deref(schema.definitions[nameOf(it)]) : it?.allOf?.length === 1 && !it.type ? deref(it.allOf[0]) : it;

function alternatives(node) {
  node = deref(node);
  const list = node?.anyOf ?? node?.oneOf;
  return list ? list.flatMap(alternatives) : node ? [node] : [];
}

/** What the schema at `node` says about a value of `type`: "object" or "array". */
function partOf(node, type) {
  const all = alternatives(node).filter(it => it.type === type);
  if (type !== "object" || all.length < 2) return all[0];
  return { ...all[0], properties: Object.assign({}, ...all.map(it => it.properties)) };
}

/** A value that the schema at `node` allows. */
function sample(node) {
  node = deref(node);
  if (!node) return null;
  if ("default" in node) return node.default;
  if (node.enum) return node.enum[0];
  if (node.anyOf || node.oneOf) return sample((node.anyOf ?? node.oneOf)[0]);
  const required = () => (node.required ?? []).map(key => [key, sample(node.properties[key])]);
  return { boolean: true, string: "x", integer: 1, number: 1, array: [], object: Object.fromEntries(required()) }[
    node.type
  ];
}

function fromSchema(written) {
  const node = deref(written);
  if (!node || node === true) return { k: "any" };
  if (node.enum && node.type === "string") return { k: "enum", variants: node.enum };
  if (node.enum && node.type === "boolean") return { k: "only", value: node.enum[0] };
  if (node.const !== undefined) return { k: "only", value: node.const };
  const list = node.anyOf ?? node.oneOf;
  if (list) {
    const alts = list.map(fromSchema);
    if (alts.every(it => it.k === "enum")) return { k: "enum", variants: alts.flatMap(it => it.variants) };
    const rest = alts.filter(it => it.k !== "null");
    const t = rest.length === 1 ? rest[0] : { k: "untagged", name: nameOf(written) ?? "?", alts: rest };
    return rest.length < alts.length ? { k: "opt", t } : t;
  }
  switch (node.type) {
    case "null":
      return { k: "null" };
    case "boolean":
      return { k: "bool" };
    case "string":
      return { k: "str" };
    case "number":
      return { k: "float" };
    case "integer": {
      const name = { uint8: "u8", uint16: "u16", uint32: "u32", uint: "usize", int32: "i32", int64: "i64" }[
        node.format
      ];
      const [, min, max] = INTEGERS.find(it => it[0] === (name ?? "u64"));
      return { k: "int", name: name ?? "u64", min, max };
    }
    case "array":
      if (Array.isArray(node.items)) return { k: "tuple", items: node.items.map(fromSchema) };
      return { k: "seq", t: fromSchema(node.items) };
    case "object":
      if (!node.properties) return { k: "map", t: fromSchema(node.additionalProperties) };
      return {
        k: "struct",
        name: nameOf(written) ?? "?",
        isOpen: node.additionalProperties !== false,
        fields: Object.entries(node.properties).map(([name, it]) => ({
          name,
          t: fromSchema(it),
          isRequired: node.required?.includes(name) ?? false,
        })),
      };
    default:
      return { k: "any" };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Working out a type from the answers

const ODD_VALUES = [null, true, 1, -1, 1.5, "x", "(", [], {}, { zz: 1 }, [[[]]], 256, 65536, 4294967296];
const notes = [];

/** The answer without what says where it was and what was received. */
const bare = answer =>
  answer &&
  answer
    .replace(/^  /, "")
    .replace(/^Error deserializing (first|second) tuple element: /, "")
    .replace(/\n  received config: `[\s\S]*`$/, "")
    .replace(/, received `[\s\S]*`$/, "");

/** What a rule says about a value that it has read, which `oxlint_options.rs` has by hand. */
const SAID_AFTERWARDS = /^(expected either `object` or `property`|`allow\w+` (requires|cannot be used with) `\w+`)$/;

/** The fields of a struct with another flattened into it that are its own. */
const OWN_FIELDS = ["elementOverrides", "allowElement", "applyToNestedElements", "line", "block"];

const DIRECTIVE = "expected a boolean, `allow-with-description`, or a descriptionFormat object";
const OPERATORS = `Invalid operator '$' in allow list. Valid values are: "!!", "~", "+", "- -", "-", "*"`;

const FRAGMENT = "<syntax,element>";

/** Places where a rule has words of its own, or takes what the schema does not have: the rule, the place, and the type. */
const BY_HAND = {
  "typescript/ban-ts-comment 0.*": {
    text: `%${quoted(DIRECTIVE)}b<allow-with-description>"x"(D descriptionFormat:r);`,
    sample: true,
  },
  "no-implicit-coercion 0.allow[]": { text: `<!!,~,+,- -,-,*>${quoted(OPERATORS)}`, sample: "!!" },
  "jest/prefer-ending-with-an-expect 0.assertFunctionNames": { text: "+[s]J", sample: [] },
  "vue/no-reserved-props 0.vueVersion": { text: `+n0R2,3"vueVersion must be either 2 or 3"`, sample: 3 },
  "jsx-a11y/control-has-associated-label 0.depth": {
    text: `+n0R0,25"depth must be less than or equal to 25"`,
    sample: 2,
  },
  "react/jsx-fragments 0": { text: `|JsxFragments ${FRAGMENT}(Mode~^ mode!:${FRAGMENT});`, sample: "syntax" },
};

/** The names in "expected `a` or `b`" and "expected one of `a`, `b`, `c`". */
const namesIn = text => [...(text ?? "").matchAll(/`([^`]+)`/g)].map(it => it[1]);

/** The type at a place of the options of `rule`. `wrap(v)`: the options with `v` at that place. `node`: the schema there. */
async function infer(rule, wrap, node, path) {
  if (BY_HAND[`${rule} ${path}`]) return { k: "text", ...BY_HAND[`${rule} ${path}`] };
  const ask = async v => {
    const answer = bare(await probe(rule, wrap(v)));
    return answer !== null && SAID_AFTERWARDS.test(answer) ? null : answer;
  };
  const answers = new Map();
  await Promise.all(ODD_VALUES.map(async v => answers.set(JSON.stringify(v), await ask(v))));
  const to = v => answers.get(JSON.stringify(v));
  const all = [...answers.values()];
  if (all.every(it => it === null)) return { k: "any" };
  const optional = t => (to(null) === null && t.k !== "any" ? { k: "opt", t } : t);
  const unknown = why => {
    const given = BY_HAND[`${rule} ${path.replace(/\.[\w-]+$/, ".*")}`];
    if (given) return { k: "text", ...given };
    notes.push(`${rule} ${path}: ${why}`);
    return { k: "any" };
  };
  // What is expected of a value that is neither a sequence nor a map. Those can be read as something else.
  const scalars = [...answers].filter(([key]) => !/^[[{]/.test(key)).map(it => it[1]);
  const expected = new Set(scalars.flatMap(it => /^invalid type: .*?, expected (.*)$/s.exec(it ?? "")?.[1] ?? []));
  if (expected.size !== 1) {
    const untagged = all.find(it => /^data did not match any variant of untagged enum/.test(it ?? ""));
    if (!untagged || expected.size > 0) return unknown(`expected ${JSON.stringify([...expected])}: ${to(1)}`);
    return optional(await inferUntagged(rule, wrap, node, path, untagged.split(" ").at(-1)));
  }
  const [phrase] = expected;
  const integer = INTEGERS.find(it => it[0] === phrase);
  if (phrase === "a boolean") return optional({ k: "bool" });
  if (integer) return optional({ k: "int", name: phrase, min: integer[1], max: integer[2] });
  if (phrase === "f64") return optional({ k: "float" });
  if (phrase === "a character") return optional({ k: "char" });
  if (phrase === "a string") {
    if (to("x") !== null) return unknown(`a string, and not "x": ${to("x")}`);
    if (to("(") === null) return optional({ k: "str" });
    const around = /^regex parse error:\n    (.*?)\((\)?)\n/.exec(to("("));
    return around ? optional({ k: "regex", before: around[1], behind: around[2] }) : unknown(to("("));
  }
  if (phrase.startsWith("a sequence")) {
    const items = partOf(node, "array")?.items;
    const t = await infer(rule, v => wrap([v]), Array.isArray(items) ? items[0] : items, `${path}[]`);
    return optional({ k: "seq", t, expected: phrase === "a sequence" ? undefined : phrase });
  }
  if (phrase === "a map") {
    const t = await infer(rule, v => wrap({ k: v }), partOf(node, "object")?.additionalProperties, `${path}{}`);
    return optional({ k: "map", t });
  }
  if (phrase === "string or map") {
    const list = /^unknown variant `x`, (?:expected (.*)|there are no variants)$/s.exec(to("x") ?? "");
    return list ? optional({ k: "enum", variants: namesIn(list[1]) }) : unknown(to("x"));
  }
  const name = /^struct (\w+)$/.exec(phrase)?.[1];
  if (!name) return unknown(`expected ${phrase}`);

  const part = partOf(node, "object");
  const aboutUnknown = to({ zz: 1 });
  const list = /^unknown field `zz`, (?:expected (.*)|there are no fields)$/s.exec(aboutUnknown ?? "");
  const isOpen = aboutUnknown === null || /^missing field/.test(aboutUnknown);
  // All of a map is flattened into it.
  if (/^invalid type: integer `1`, expected /.test(aboutUnknown)) {
    const t = await infer(rule, v => wrap({ k: v }), part?.additionalProperties, `${path}{}`);
    return optional({ k: "map", t, expected: phrase });
  }
  if (!list && !isOpen && aboutUnknown !== "unknown field `zz`") return unknown(aboutUnknown);
  const hasFlattened = !list && /^invalid type: sequence/.test(to([]) ?? "");
  const required = {};
  for (;;) {
    const missing = /^missing field `([^`]+)`$/.exec((await ask({ ...required })) ?? "")?.[1];
    if (!missing) break;
    required[missing] = sample(part?.properties?.[missing]);
  }
  const fields = await Promise.all(
    (list ? namesIn(list[1]) : Object.keys(part?.properties ?? {})).map(async field => ({
      name: field,
      t: await infer(rule, v => wrap({ ...required, [field]: v }), part?.properties?.[field], `${path}.${field}`),
      isRequired: field in required,
      isFlattened: hasFlattened && !OWN_FIELDS.includes(field),
    })),
  );
  // Two names of one field are next to each other.
  for (let at = 0; at + 1 < fields.length; at++) {
    const [one, other] = [fields[at], fields[at + 1]];
    const both = { ...required, [one.name]: sampleOf(one.t), [other.name]: sampleOf(other.t) };
    const twice = /^duplicate field `([^`]+)`$/.exec((await ask(both)) ?? "")?.[1];
    if (twice === one.name) other.alias = "@";
    if (twice === other.name) one.alias = "$";
  }
  // The fields that a sequence has to have an element for. The order of the fields is known if they were listed.
  const own = fields.filter(it => !it.alias);
  for (const elements = []; list && elements.length < own.length;) {
    const at = Number(/^invalid length (\d+), expected struct/.exec((await ask([...elements])) ?? "")?.[1]);
    if (!(at >= elements.length)) break;
    own[at].isNeeded = true;
    while (elements.length <= at) elements.push(sampleOf(own[elements.length].t));
  }
  const hasNoDefaults = list ? own.length > 0 && own.every(it => it.isNeeded) : /^invalid length 0/.test(to([]) ?? "");
  if (hasNoDefaults) own.forEach(it => delete it.isNeeded);
  const struct = { k: "struct", name, fields, isOpen, hasFlattened, hasNoDefaults };
  // A number or the like in place of the struct.
  const short = [];
  if (to(true) === null) short.push({ k: "bool" });
  if (to("x") === null) short.push({ k: "str" });
  if (to(1) === null && to(1.5) === null) short.push({ k: "float" });
  else if (to(1) === null) {
    const size = to(256) !== null ? "u8" : to(65536) !== null ? "u16" : to(4294967296) !== null ? "u32" : "u64";
    short.push({ k: "int", name: to(-1) === null ? "i64" : size });
  }
  return optional(short.length > 0 ? { k: "oneOf", alts: [...short, struct] } : struct);
}

/** The same where every answer is "data did not match any variant of untagged enum `name`". */
async function inferUntagged(rule, wrap, node, path, name) {
  let t = fromSchema(node);
  if (t.k === "opt") t = t.t;
  t = t.k === "untagged" ? { ...t, name } : { k: "untagged", name, alts: [t] };
  // One of the two names, and not both.
  t.alts = t.alts.flatMap(alt => {
    if (alt.k !== "struct" || !alt.fields.some(it => it.name === "propNamePattern")) return [alt];
    return ["propName", "propNamePattern"].map(key => {
      const fields = alt.fields.filter(it => !it.name.startsWith("propName") || it.name === key);
      return structuredClone({
        ...alt,
        fields: fields.map(it => ({ ...it, isRequired: it.isRequired || it.name === key })),
      });
    });
  });
  const takes = async v => (await probe(rule, wrap(v))) === null;
  const structs = t.alts.filter(it => it.k === "struct");
  if (structs.length > 0 && !(await takes([]))) structs.forEach(it => (it.hasNoDefaults = true));
  const refine = async (struct, put) => {
    const base = sampleOf(struct);
    if (!(await takes(put(base)))) notes.push(`${rule} ${path}: ${JSON.stringify(base)} is no ${struct.name}`);
    await Promise.all(
      struct.fields.map(async field => {
        const real = new Map();
        const withIt = v => put({ ...base, [field.name]: v });
        await Promise.all(ODD_VALUES.map(async v => real.set(v, await takes(withIt(v)))));
        const wrong = () => ODD_VALUES.filter(v => real.get(v) !== fits(t, withIt(v)));
        if (wrong().includes(null) && real.get(null)) field.t = { k: "opt", t: field.t };
        const inner = field.t.k === "opt" ? field.t.t : field.t;
        if (inner.k === "struct" && wrong().some(v => Array.isArray(v) && v.length === 0)) inner.hasNoDefaults = true;
        if (wrong().length > 0) notes.push(`${rule} ${path}.${struct.name}.${field.name}: ${JSON.stringify(wrong())}`);
        if (inner.k === "struct") await refine(inner, withIt);
      }),
    );
  };
  for (const struct of structs) await refine(struct, v => v);
  // The schema has the fields by their names. A sequence has them as they are declared: the one order in which it is taken, with
  // a value for each field, with `null` for each that can be that, and with another kind of value for each that can be that.
  if (t.alts.every(it => it.k !== "seq" && it.k !== "tuple")) {
    for (const struct of structs) {
      if (numberOfOrders(struct.fields) > 200) continue;
      const orders = ordersOf(struct.fields);
      const values = [
        it => sampleOf(it.t),
        it => (it.t.k === "opt" ? null : sampleOf(it.t)),
        it => sampleOf(it.t.k === "untagged" ? it.t.alts.at(-1) : it.t),
      ];
      const isTaken = async order => (await Promise.all(values.map(it => takes(order.map(it))))).every(Boolean);
      const taken = (await Promise.all(orders.map(async it => ((await isTaken(it)) ? [it] : [])))).flat();
      if (taken.length === 1) struct.fields = taken[0];
      // It has other fields than the schema says, or is not read from a sequence.
      else if (taken.length === 0) struct.hasFlattened = true;
      else notes.push(`${rule} ${path}.${struct.name}: ${taken.length} of ${orders.length} orders are taken`);
    }
  }
  return t;
}

/** `fields` in every order, without those that differ in where fields of one type are. */
function ordersOf(fields) {
  if (fields.length < 2) return [fields];
  const firsts = fields.filter((it, at) => fields.findIndex(other => write(other.t) === write(it.t)) === at);
  return firsts.flatMap(first => ordersOf(fields.filter(it => it !== first)).map(rest => [first, ...rest]));
}

function numberOfOrders(fields) {
  const factorial = n => (n < 2 ? 1 : n * factorial(n - 1));
  const ofOneType = Object.values(Object.groupBy(fields, it => write(it.t)));
  return ofOneType.reduce((all, it) => all / factorial(it.length), factorial(fields.length));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The rows

const TAKES_NONE = "  This rule does not accept configuration options.";
const NO_PATTERN = quoted("invalid assert function pattern `$`: ");
const NO_LIST = quoted("Expected 'object' property to be an array");
const NO_GLOBAL = quoted("Expected 'globals' array to contain either strings or objects");
const READ_BY_HAND = {
  "logical-assignment-operators": "L",
  "no-unused-vars": "U",
  "jest/expect-expect": `F%""(Options~^ assertFunctionNames:J${NO_PATTERN})*;`,
  "vitest/expect-expect": `F%""(Options~^ assertFunctionNames:J${NO_PATTERN})*;`,
  "no-restricted-globals": `W[%""(Options~^ globals:+|${NO_LIST}[*];[|${NO_GLOBAL}s{*};])*;]`,
};
const rows = {};

async function rowOf(rule) {
  const first = await Promise.all(ODD_VALUES.map(v => probe(rule, [v])));
  if (first.every(it => it === TAKES_NONE)) return;
  if (READ_BY_HAND[rule]) return READ_BY_HAND[rule];
  const shapes = (rules[rule].anyOf ?? []).flatMap(it => (it.anyOf ?? [it]).map(deref));
  const [items = []] = shapes
    .flatMap(it => (Array.isArray(it.items) ? [it.items] : []))
    .sort((a, b) => b.length - a.length);
  const additional = shapes.find(it => it.additionalItems)?.additionalItems;
  const said = first.filter(it => it !== null);
  const saysAll = said.some(it => /, received `/.test(it));
  const isEither = said.some(it => /first or second tuple type/.test(it));
  if (rule === "no-restricted-properties") return `P[${write(await infer(rule, v => [v], additional, "0"))}]`;
  if (saysAll && additional) return `w[${write(await infer(rule, v => [v], additional, "0"))}]`;
  if (saysAll || isEither) {
    const [types, before] = [[], []];
    for (let at = 1; at < items.length; at++) {
      const start = [...before];
      // With one element either of the two is meant. The other is there to tell.
      const end = isEither && at === 1 ? [sample(items[2])] : [];
      types.push(await infer(rule, v => [...start, v, ...end], items[at], String(at - 1)));
      before.push(sample(items[at]));
    }
    return (isEither ? "E" : "w") + write({ k: "tuple", items: types });
  }
  if (said.length === 0 && items.length > 2) {
    const second = await infer(rule, v => [sample(items[1]), v], items[2], "1");
    if (second.k !== "any") return `S${write(second)}`;
  }
  const saysOne = said.some(it => /\n  received config: `/.test(it));
  return (saysOne || said.length === 0 ? "f" : "F") + write(await infer(rule, v => [v], items[1], "0"));
}

await drive(Object.keys(rules).map(async rule => (rows[rule] = await rowOf(rule))));
rmSync(scratch, { recursive: true });

function replace(rule, from, to) {
  const next = rows[rule].replace(from, to);
  if (next === rows[rule]) throw new Error(`${rule}: no ${from} in ${rows[rule]}`);
  rows[rule] = next;
}
replace("sort-imports", "memberSyntaxSortOrder:[<none,all,multiple,single>]", "memberSyntaxSortOrder:Q");
// One word in place of the struct, which no answer and no schema mentions.
replace("no-use-before-define", /^f(\(.*\))$/, 'f/<nofunc>"x"$1;');
replace(
  "unicorn/import-style",
  "|RawModuleStylesOverride F",
  `!${quoted("module style override boolean must be `false`")}|RawModuleStylesOverride b`,
);

// Most structs are called like their rule.
for (const [rule, row] of Object.entries(rows)) {
  const words = rule.split("/").at(-1).split("-");
  const name = words.map(it => it[0].toUpperCase() + it.slice(1)).join("");
  if (row) rows[rule] = row.replaceAll(`(${name}`, "(&");
}

/** Where the type that starts at `from` ends. */
function endOf(text, from) {
  let at = from;
  const skipQuoted = () => {
    if (text[at] !== '"') return;
    for (at++; text[at] !== '"'; at++) if (text[at] === "\\") at++;
    at++;
  };
  const skipList = () => {
    while (text[at] !== ";") at = endOf(text, at);
    at++;
  };
  switch (text[at++]) {
    case "n":
      return at + 1;
    case "r":
      skipQuoted();
      skipQuoted();
      return at;
    case "?":
      return endOf(text, at);
    case "+":
      return endOf(text, endOf(text, at));
    case "R":
      at = text.indexOf('"', at);
      skipQuoted();
      return at;
    case "J":
      skipQuoted();
      return at;
    case "[":
    case "{":
      at = endOf(text, at) + 1;
      skipQuoted();
      return at;
    case "<":
      at = text.indexOf(">", at) + 1;
      skipQuoted();
      return at;
    case "=":
      return text.indexOf(";", at) + 1;
    case "|":
      if (text[at] === '"') skipQuoted();
      else at = text.indexOf(" ", at) + 1;
      skipList();
      return at;
    case "%":
      skipQuoted();
      skipList();
      return at;
    case "#":
    case "/":
      skipList();
      return at;
    case "!":
      skipQuoted();
      return endOf(text, at);
    case "(":
      while (text[at] !== ")") {
        if (text[at] === ":") at = endOf(text, at + 1);
        else at++;
      }
      return at + 1;
    default:
      return at;
  }
}

/** Every type in `text`, which is a type. */
function* typesIn(text, from = 0, end = text.length) {
  for (let at = from; at < end; at++) {
    const isStart = at === from || ':?+[{#|/%;>")'.includes(text[at - 1]) || /[a-zA-Z0-9*_ ]/.test(text[at - 1]);
    if (isStart && "[{<(|/%#?".includes(text[at])) {
      try {
        yield text.slice(at, endOf(text, at));
      } catch {}
    }
  }
}

// What several rows have is written once, as long as that saves something.
const shared = [];
for (;;) {
  const count = new Map();
  for (const text of [...Object.values(rows).map(it => it?.slice(1) ?? ""), ...shared]) {
    for (const part of new Set(typesIn(text))) {
      if (part.length < 8 || part.includes("&")) continue;
      count.set(part, (count.get(part) ?? 0) + text.split(part).length - 1);
    }
  }
  const reference = `=${shared.length};`;
  const gain = ([part, times]) => (times - 1) * part.length - times * reference.length - 4;
  const [best] = [...count].filter(it => it[1] > 1 && gain(it) > 24).sort((a, b) => gain(b) - gain(a));
  if (!best) break;
  for (const rule of Object.keys(rows)) rows[rule] = rows[rule]?.replaceAll(best[0], reference);
  shared.forEach((it, at) => (shared[at] = it.replaceAll(best[0], reference)));
  shared.push(best[0]);
}

const lines = [
  ...Object.entries(rows)
    .filter(it => it[1])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([rule, row]) => `${rule} ${row}`),
  ...shared.map((it, at) => `=${at} ${it}`),
];
const text = `//! Generated by \`generate-oxlint-fields.mjs\` from oxlint ${version}. Not edited by hand.

/// For each rule of oxlint that takes options, as \`oxlint_rule_key\` writes it: a line break, the rule, a blank, and what its options
/// look like. The script says how that is written. A rule of oxlint that is not here takes no options.
#[rustfmt::skip]
pub(super) static OPTIONS: &str = concat!(
${lines.map(line => `    "\\n", r#"${line}"#,`).join("\n")}
    "\\n",
);
`;
writeFileSync(join(import.meta.dirname, "oxlint_fields.rs"), text);
console.log(`${lines.length - shared.length} rules, ${shared.length} shared, ${lines.join("\n").length + 2} bytes`);
for (const note of notes) console.log(note);
