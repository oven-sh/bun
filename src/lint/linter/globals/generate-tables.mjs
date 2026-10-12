// Generates `tables.rs`: the names of the global variables that ESLint, the `globals` package and
// typescript-eslint's scope manager know, and where the environments of ESLint 8 and of oxlint are other than those of today.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> \
//   TYPESCRIPT_ESLINT_DIR=<built checkout of typescript-eslint> \
//   ESLINT_8_DIR=<node_modules/eslint of 8.57.1> \
//   JAVASCRIPT_GLOBALS_DIR=<the crate javascript-globals that oxlint is built with, unpacked> node generate-tables.mjs [--check]
//
// `--check`: writes nothing, and fails if `tables.rs` is not what would be written.
//
// All names are in one sorted pool. A list (an environment, what a version of ECMAScript adds, a
// library of TypeScript, the changes to an environment) is a run of `index of the name << 2 | flags`.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const requireFromEslint = createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"));
const requireFromScopeManager = createRequire(
  join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/scope-manager/package.json"),
);
const conf = requireFromEslint("./conf/globals.js");
const environments = requireFromEslint("globals");
const { lib: libs } = requireFromScopeManager("./dist/lib/index.js");
const versionOf = name => requireFromEslint(`${name}/package.json`).version;

const WRITABLE = 1,
  REMOVED = 2,
  TYPE = 1,
  VALUE = 2;

/** name of the list -> [[name, flags]] */
const lists = new Map();
for (const [name, globals] of Object.entries(environments)) {
  lists.set(
    `env:${name}`,
    Object.entries(globals).map(([name, writable]) => [name, writable ? WRITABLE : 0]),
  );
}

// What another tool has in its environments: only what is not as it is today.
/** `theirs`: { environment: { name: writable } }. `always`: what is defined whatever `env` says. */
function changes(tool, theirs, always = {}) {
  const found = [];
  for (const environment of [...new Set([...Object.keys(theirs), ...Object.keys(environments)])]) {
    const [before, after] = [environments[environment] ?? {}, theirs[environment] ?? {}];
    const list = [];
    for (const [name, writable] of Object.entries(after))
      if (!Object.hasOwn(before, name) || Boolean(before[name]) !== Boolean(writable))
        list.push([name, writable ? WRITABLE : 0]);
    for (const [name, writable] of Object.entries(before))
      if (!Object.hasOwn(after, name) && !(Object.hasOwn(always, name) && Boolean(always[name]) === Boolean(writable)))
        list.push([name, REMOVED]);
    if (list.length === 0) continue;
    lists.set(`${tool}:${environment}`, list);
    found.push(environment);
  }
  return found;
}

// ESLint 8 has no environment that is not in this list, so what `globals` has beside them is never asked for.
const requireFromEslint8 = createRequire(join(resolve(process.env.ESLINT_8_DIR), "package.json"));
const environments8 = Object.fromEntries(
  [...requireFromEslint8("@eslint/eslintrc").Legacy.environments].map(([name, it]) => [name, it.globals ?? {}]),
);
const { builtin: always8, es6: _, ...known8 } = environments8;
for (const name of Object.keys(environments)) known8[name] ??= environments[name];
const changed8 = changes("eslint8", known8, always8);

// An environment that oxlint does not know it takes and defines nothing for.
const crate = resolve(process.env.JAVASCRIPT_GLOBALS_DIR);
const crateText = readFileSync(join(crate, "src/lib.rs"), "utf8");
const maps = new Map();
for (const [, name, body] of crateText.matchAll(
  /pub static (GLOBALS_\w+): phf::Map<&'static str, bool> = ::phf::Map \{([\s\S]*?)\n\};/g,
))
  maps.set(
    name,
    Object.fromEntries([...body.matchAll(/\("([^"]+)", (true|false)\)/g)].map(it => [it[1], it[2] === "true"])),
  );
const [, index] = /pub static GLOBALS: Globals = Globals\(::phf::Map \{([\s\S]*?)\n\}\);/.exec(crateText);
const environmentsOfOxlint = Object.fromEntries(
  [...index.matchAll(/\("([^"]+)", &(GLOBALS_\w+)\)/g)].map(it => [it[1], maps.get(it[2])]),
);
if (Object.keys(environmentsOfOxlint).length < 40 || Object.values(environmentsOfOxlint).includes(undefined))
  throw new Error("cannot read the crate");
const changedOfOxlint = changes("oxlint", environmentsOfOxlint);
const versionOfCrate = /^version = "([^"]+)"/m.exec(readFileSync(join(crate, "Cargo.toml"), "utf8"))[1];

const years = Object.keys(conf)
  .filter(key => /^es\d+$/.test(key))
  .map(key => Number(key.slice(2)))
  .sort((a, b) => a - b);
let previous = {};
for (const year of years) {
  const globals = conf[`es${year}`];
  for (const name of Object.keys(previous))
    if (globals[name] !== previous[name]) throw new Error(`es${year} changes ${name}`);
  lists.set(
    `es:${year}`,
    Object.entries(globals)
      .filter(([name]) => !Object.hasOwn(previous, name))
      .map(([name, writable]) => [name, writable ? WRITABLE : 0]),
  );
  previous = globals;
}
lists.set(
  "commonjs",
  Object.entries(conf.commonjs).map(([name, writable]) => [name, writable ? WRITABLE : 0]),
);
const libNames = [...libs.keys()].sort();
const libIndex = new Map(libNames.map((name, i) => [libs.get(name), i]));
for (const name of libNames) {
  const flags = v => (v.isTypeVariable ? TYPE : 0) | (v.isValueVariable ? VALUE : 0);
  lists.set(
    `lib:${name}`,
    libs.get(name).variables.map(([name, variable]) => [name, flags(variable)]),
  );
}

const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const names = [...new Set([...lists.values()].flatMap(list => list.map(it => it[0])))].sort(compare);
const idOf = new Map(names.map((name, i) => [name, i]));
if (names.length >= 1 << 14) throw new Error("too many names");

const entries = [];
const rangeOf = new Map();
for (const [list, items] of lists) {
  rangeOf.set(list, [entries.length, items.length]);
  entries.push(...items.map(([name, flags]) => (idOf.get(name) << 2) | flags).sort((a, b) => a - b));
}
if (entries.length >= 1 << 16) throw new Error("too many entries");

const dependencies = [];
const libRows = libNames.map(name => {
  const start = dependencies.length;
  dependencies.push(...libs.get(name).libs.map(it => libIndex.get(it)));
  return `    ("${name}", ${rangeOf.get(`lib:${name}`).join(", ")}, ${start}, ${dependencies.length - start}),`;
});

const rows = (numbers, perRow = 20) => {
  const out = [];
  for (let i = 0; i < numbers.length; i += perRow) out.push("    " + numbers.slice(i, i + perRow).join(", ") + ",");
  return out.join("\n");
};
const pool = [];
let line = "";
for (const name of names) {
  if (line.length + name.length > 110) {
    pool.push(line);
    line = "";
  }
  line += name;
}
pool.push(line);
let end = 0;
const ends = names.map(name => (end += Buffer.byteLength(name)));
if (end >= 1 << 16) throw new Error("the pool is too large");

const changeRows = (tool, found) =>
  found
    .sort(compare)
    .map(name => `    ("${name}", ${rangeOf.get(`${tool}:${name}`).join(", ")}),`)
    .join("\n");
const text = `//! Generated by \`generate-tables.mjs\` from eslint ${versionOf("eslint")} (\`conf/globals.js\`), globals ${versionOf("globals")},
//! @typescript-eslint/scope-manager ${requireFromScopeManager("./package.json").version} (\`src/lib\`), eslint ${requireFromEslint8("./package.json").version} with globals ${requireFromEslint8("globals/package.json").version}, and
//! javascript-globals ${versionOfCrate}. Not edited by hand.

/// All names, sorted, one after the other.
#[rustfmt::skip]
pub(super) static NAMES: &[u8] = b"\\
${pool.join("\\\n")}";

/// Where each name ends in \`NAMES\`.
#[rustfmt::skip]
pub(super) static NAME_ENDS: &[u16] = &[
${rows(ends)}
];

/// The lists, one after the other, each sorted: the index of a name \`<< 2\`, and flags. For an
/// environment and a version of ECMAScript, 1: writable. For a library, 1: a type, 2: a value. For
/// the changes to an environment, 1: writable, 2: it is not in it.
#[rustfmt::skip]
pub(super) static ENTRIES: &[u16] = &[
${rows(entries)}
];

/// The environments of the \`globals\` package, sorted by name: where each starts in \`ENTRIES\`, and
/// how many entries it has.
#[rustfmt::skip]
pub(super) static ENVIRONMENTS: &[(&str, u16, u16)] = &[
${Object.keys(environments)
  .sort(compare)
  .map(name => `    ("${name}", ${rangeOf.get(`env:${name}`).join(", ")}),`)
  .join("\n")}
];

/// Where the environments of ESLint 8 are other than \`ENVIRONMENTS\`, sorted by name. Not what its \`builtin\` defines anyway.
#[rustfmt::skip]
pub(super) static CHANGES_FOR_ESLINT_8: &[(&str, u16, u16)] = &[
${changeRows("eslint8", changed8)}
];

/// The same for oxlint. It has environments that are not in \`ENVIRONMENTS\`.
#[rustfmt::skip]
pub(super) static CHANGES_FOR_OXLINT: &[(&str, u16, u16)] = &[
${changeRows("oxlint", changedOfOxlint)}
];

/// \`conf/globals.js\`: what each version of ECMAScript adds to the one before it.
#[rustfmt::skip]
pub(super) static ECMA_VERSIONS: &[(u32, u16, u16)] = &[
${years.map(year => `    (${year}, ${rangeOf.get(`es:${year}`).join(", ")}),`).join("\n")}
];

/// \`conf/globals.js\`: what \`sourceType: "commonjs"\` adds.
pub(super) static COMMONJS: (u16, u16) = (${rangeOf.get("commonjs").join(", ")});

/// The libraries of TypeScript, sorted by name: the entries, and where the libraries that it
/// includes start in \`LIB_DEPENDENCIES\`, and how many they are.
#[rustfmt::skip]
pub(super) static LIBS: &[(&str, u16, u16, u16, u8)] = &[
${libRows.join("\n")}
];

/// Indices into \`LIBS\`.
#[rustfmt::skip]
pub(super) static LIB_DEPENDENCIES: &[u8] = &[
${rows(dependencies)}
];
`;
const path = join(import.meta.dirname, "tables.rs");
if (!process.argv.includes("--check")) writeFileSync(path, text);
else if (readFileSync(path, "utf8") !== text) throw new Error("tables.rs is not what this writes");
console.log(`${names.length} names (${end} bytes), ${entries.length} entries, ${libNames.length} libraries`);
