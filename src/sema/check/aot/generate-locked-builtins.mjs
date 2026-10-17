// Generates `locked_builtins_generated.rs`: the built-in objects that `--aot` makes immutable. The build (TS100014) and the
// rules `bun/aot-*` of `bun lint` read it.
//
//   bun src/sema/check/aot/generate-locked-builtins.mjs [--check]
//
// Nothing is listed by hand. The script runs itself twice, with and without `--aot`. Each run tries to assign to, define and
// delete every property of every global object, of its prototype and of what a namespace such as `Intl` holds, and the
// properties that these inherit. What throws under `--aot` alone is what `--aot` refuses. Run it again after an upgrade of
// JavaScriptCore. With `--check` it writes nothing, and fails if the file is out of date.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf } = Object;
const { ownKeys } = Reflect;

/** `Symbol.iterator` is `@@iterator`. */
const nameOf = key => (typeof key === "symbol" ? "@@" + String(key.description).replace("Symbol.", "") : key);

function throws(change) {
  try {
    change();
    return false;
  } catch {
    return true;
  }
}

function quietly(change) {
  try {
    change();
  } catch {}
}

const otherLike = value => (typeof value === "number" ? value + 1 : typeof value === "string" ? value + "x" : undefined);

/** Tries everything, puts everything back, and returns which of it threw. */
function walk() {
  const objects = {};
  const names = new Map();
  const found = [];

  function visit(name, object, depth) {
    if (object === null || (typeof object !== "object" && typeof object !== "function") || names.has(object)) return;
    names.set(object, name);
    found.push([name, object]);
    const prototype = getOwnPropertyDescriptor(object, "prototype")?.value;
    visit(name + ".prototype", prototype, 0);
    if (depth === 0 || typeof object !== "object") return;
    for (const key of ownKeys(object)) {
      const value = typeof key === "string" ? getOwnPropertyDescriptor(object, key).value : undefined;
      const isClass = typeof value === "function" && getOwnPropertyDescriptor(value, "prototype");
      if (isClass || (value && typeof value === "object")) visit(name + "." + key, value, depth - 1);
    }
  }

  names.set(globalThis, "");
  found.push(["", globalThis]);
  for (const key of ownKeys(globalThis)) {
    if (typeof key !== "string" || ["process", "Bun", "globalThis", "self", "global"].includes(key)) continue;
    const descriptor = getOwnPropertyDescriptor(globalThis, key);
    visit(key, descriptor.get ? globalThis[key] : descriptor.value, 1);
  }
  visit("%TypedArray%", getPrototypeOf(Uint8Array), 0);

  for (const [name, object] of found) {
    const other = function () {};
    const added = { value: other, configurable: true, writable: true };
    const own = { __proto__: null };
    for (const key of ownKeys(object)) {
      const descriptor = getOwnPropertyDescriptor(object, key);
      const restore = () => quietly(() => defineProperty(object, key, descriptor));
      const like = otherLike(descriptor.value);
      const assign = throws(() => (object[key] = other)) && (like === undefined || throws(() => (object[key] = like)));
      restore();
      const define = throws(() => defineProperty(object, key, added));
      restore();
      const remove = throws(() => {
        if (!delete object[key]) throw new TypeError();
      });
      restore();
      const type = "value" in descriptor ? typeof descriptor.value + (descriptor.value ? "" : "?") : "accessor";
      own[nameOf(key)] = [assign, define, remove, type];
    }
    const inherited = { __proto__: null };
    for (let ancestor = getPrototypeOf(object); ancestor; ancestor = getPrototypeOf(ancestor)) {
      for (const key of ownKeys(ancestor)) {
        if (nameOf(key) in own || nameOf(key) in inherited || key === "__proto__") continue;
        const assign = throws(() => (object[key] = other));
        quietly(() => delete object[key]);
        const define = throws(() => defineProperty(object, key, added));
        quietly(() => delete object[key]);
        inherited[nameOf(key)] = [assign, define];
      }
    }
    const add = throws(() => defineProperty(object, "addedByThisScript", added));
    quietly(() => delete object.addedByThisScript);
    const parent = getPrototypeOf(object);
    const reparent = throws(() => setPrototypeOf(object, {}));
    quietly(() => setPrototypeOf(object, parent));
    objects[name] = { own, inherited, add, reparent, inherits: parent === null ? null : (names.get(parent) ?? "") };
  }
  return objects;
}

if (process.argv[2] === "--walk") {
  writeFileSync(process.argv[3], JSON.stringify(walk()));
  process.exit(0);
}

function run(...flags) {
  const directory = mkdtempSync(join(tmpdir(), "aot-builtins-"));
  const file = join(directory, "walk.json");
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [process.execPath, "run", ...flags, import.meta.filename, "--walk", file],
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (exitCode !== 0) throw new Error(`bun run ${flags.join(" ")} failed:\n${stderr}`);
  const objects = JSON.parse(readFileSync(file, "utf8"));
  rmSync(directory, { recursive: true });
  return objects;
}

const plain = run();
const compiled = run("--aot");

/** Before the name of a property. See `Builtin::properties`. */
function markOf([assign, define, remove], [assignedPlain, definedPlain, removedPlain]) {
  if (assign === assignedPlain && define === definedPlain && remove === removedPlain) return assign && define && remove ? "!" : "-";
  if (assign && !assignedPlain) return define === definedPlain && remove === removedPlain ? "=" : "";
  return "~";
}

const differs = name =>
  compiled[name].add !== plain[name].add ||
  compiled[name].reparent !== plain[name].reparent ||
  Object.keys(compiled[name].own).some(key => !"!-".includes(markOf(compiled[name].own[key], plain[name].own[key])));
const isListed = name => name === "" || differs(name);

const table = new Map();
for (const name of Object.keys(compiled).filter(isListed).sort()) {
  const { own, add, inherits } = compiled[name];
  const marked = Object.keys(own).map(key => {
    const type = own[key][3];
    return markOf(own[key], plain[name].own[key]) + key + (type === "function" ? "" : ":" + type);
  });
  table.set(name, {
    inherits: inherits === null || name === "" ? "" : inherits !== "" && isListed(inherits) ? inherits : "%",
    isExtensible: !add,
    properties: (name === "" ? marked.filter(it => !it.startsWith("-") && it !== "!Bun:object") : marked).sort(),
  });
}

/** `Builtin::refuses` */
function refuses(name, key, change) {
  const markIn = name => {
    const found = table.get(name).properties.find(it => it.replace(/^[~!=-]/, "").replace(/:.*$/, "") === key);
    return found === undefined ? undefined : /^[~!=-]/.test(found) ? found[0] : "";
  };
  const { inherits, isExtensible } = table.get(name);
  const own = markIn(name);
  if (own !== undefined) return own === "" || (own === "~" && change !== "assign") || (own === "=" && change === "assign");
  if (change === "delete") return false;
  for (let ancestor = inherits; table.has(ancestor) && ancestor !== ""; ancestor = table.get(ancestor).inherits) {
    const inherited = markIn(ancestor);
    if (inherited !== undefined && inherited !== "-") return inherited === "" || change === "define";
  }
  return !isExtensible;
}

// The table has to answer as the engine did.
for (const name of table.keys()) {
  const check = (key, change, refused, rejectedPlain) => {
    if (refuses(name, key, change) !== (refused && !rejectedPlain)) throw new Error(`${name || "globalThis"}: ${change} ${key}`);
  };
  for (const [key, answers] of Object.entries(compiled[name].own)) {
    ["assign", "define", "delete"].forEach((change, i) => check(key, change, answers[i], plain[name].own[key][i]));
    if (answers[3] !== plain[name].own[key][3]) throw new Error(`${name || "globalThis"}: ${key} is ${answers[3]}, and ${plain[name].own[key][3]} without --aot`);
  }
  for (const [key, answers] of Object.entries(compiled[name].inherited)) {
    ["assign", "define"].forEach((change, i) => check(key, change, answers[i], plain[name].inherited[key][i]));
  }
  if ((name !== "" && name !== "Object.prototype") !== (compiled[name].reparent && !plain[name].reparent)) throw new Error(`${name || "globalThis"}: another prototype`);
}

const text = JSON.stringify;
const entries = [...table].map(
  ([name, { inherits, isExtensible, properties }]) =>
    `    Builtin {\n        name: ${text(name)},\n        inherits: ${text(inherits)},\n        is_extensible: ${isExtensible},\n        properties: ${text(properties.join(" "))},\n    },\n`,
);
const generated = `// Generated by src/sema/check/aot/generate-locked-builtins.mjs. Do not edit.\n\nuse super::locked_builtins::Builtin;\n\npub(super) static BUILTINS: &[Builtin] = &[\n${entries.join("")}];\n`;

const path = join(import.meta.dirname, "locked_builtins_generated.rs");
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== generated) {
    console.error("locked_builtins_generated.rs is out of date. Run: bun src/sema/check/aot/generate-locked-builtins.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(path, generated);
}
