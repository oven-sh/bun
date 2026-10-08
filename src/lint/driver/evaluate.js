// Runs a configuration file that is a program, and prints what it exports as the JSON that
// `bun_lint::linter::Config::from_flat_json` documents, with what the result depends on, so that it
// can be kept for the next run: the files that were loaded or looked at, and the environment
// variables that were read.
const path = process.argv.at(-1);
const marker = process.argv.at(-2);
const { fileURLToPath, pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

// ───────────── what the file depends on ─────────────

const touched = new Set();
const environment = new Set();
// It depends on something that cannot be checked again cheaply.
let uncacheable = false;

function wrap(object, names, before) {
  for (const name of names) {
    const original = object?.[name];
    if (typeof original !== "function") continue;
    const wrapper = function (...args) {
      before(...args);
      return Reflect.apply(original, this, args);
    };
    try {
      object[name] = Object.assign(wrapper, original);
    } catch {
      uncacheable = true;
    }
  }
}
const touch = file => {
  try {
    if (file instanceof URL) touched.add(fileURLToPath(file));
    else if (typeof file === "string" || Buffer.isBuffer(file)) touched.add(resolve(String(file)));
  } catch {}
};
const giveUp = () => {
  uncacheable = true;
};
const reads = ["readFile", "readdir", "stat", "lstat", "access", "realpath", "open", "opendir", "exists"];
const fs = require("node:fs");
wrap(fs, [...reads, ...reads.map(name => `${name}Sync`), "createReadStream"], touch);
wrap(fs.promises, reads, touch);
wrap(fs, ["glob", "globSync", "watch", "watchFile"], giveUp);
wrap(fs.promises, ["glob", "watch"], giveUp);
wrap(require("node:child_process"), ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"], giveUp);
wrap(globalThis, ["fetch"], giveUp);
wrap(globalThis.Bun, ["spawn", "spawnSync", "$", "Glob", "connect"], giveUp);
wrap(globalThis.Bun, ["file"], touch);
// Only the names leave this process: the values can be secrets.
const note = key => {
  if (typeof key === "string") environment.add(key);
};
// Packages list the environment to look for their own variables (`debug`: `DEBUG_*`).
const isCalledByPackage = () => {
  const caller = new Error().stack.split("\n").find(line => /[\\/]/.test(line) && !line.includes("[eval]"));
  return caller !== undefined && /[\\/]node_modules[\\/]/.test(caller);
};
process.env = new Proxy(process.env, {
  get: (target, key) => (note(key), target[key]),
  has: (target, key) => (note(key), key in target),
  set: (target, key, value) => ((target[key] = value), true),
  ownKeys: target => (isCalledByPackage() || giveUp(), Reflect.ownKeys(target)),
});

// ───────────── as JSON ─────────────

const unserializable = what => ({ $unserializable: what });

// `name@version` of a parser, a plugin or a processor: ESLint's `getObjectId`.
function objectId(object) {
  const name = object.name ?? object.meta?.name;
  if (typeof name !== "string" || !name) return null;
  const version = object.version ?? object.meta?.version;
  return typeof version === "string" && version ? `${name}@${version}` : name;
}

function serialize(value, ancestors = []) {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : unserializable("number");
    case "undefined":
      return undefined;
    case "object":
      break;
    default:
      return unserializable(typeof value);
  }
  if (value === null) return null;
  if (ancestors.includes(value)) return unserializable("circular");
  const inner = [...ancestors, value];
  if (Array.isArray(value)) return value.map(item => serialize(item, inner) ?? null);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unserializable(value.constructor?.name ?? "object");
  const entries = Object.entries(value).map(([key, item]) => [key, serialize(item, inner)]);
  return Object.fromEntries(entries.filter(([, item]) => item !== undefined));
}

function serializeLanguageOptions({ parser, parserOptions, ...rest }) {
  const out = serialize(rest);
  if (parser !== undefined) out.parser = (parser && objectId(parser)) ?? "unknown";
  if (parserOptions !== undefined && parserOptions !== null) {
    // A parser among the options of another one, as `vue-eslint-parser` has it.
    const { parser: inner, programs, ...options } = parserOptions;
    out.parserOptions = serialize(options);
    if (inner !== undefined) {
      out.parserOptions.parser = typeof inner === "string" ? inner : ((inner && objectId(inner)) ?? serialize(inner));
    }
    if (programs) out.parserOptions.programs = true;
  }
  return out;
}

function serializeConfigObject(config) {
  if (config === null || typeof config !== "object") return serialize(config) ?? null;
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  if (plugins && typeof plugins === "object") {
    const ids = Object.entries(plugins).map(([prefix, plugin]) => [prefix, (plugin && objectId(plugin)) ?? null]);
    out.plugins = Array.isArray(plugins) ? serialize(plugins) : Object.fromEntries(ids);
  }
  if (languageOptions && typeof languageOptions === "object") {
    out.languageOptions = serializeLanguageOptions(languageOptions);
  }
  if (processor !== undefined) {
    out.processor = typeof processor === "string" ? processor : ((processor && objectId(processor)) ?? "unknown");
  }
  // Only a file that does not call `defineConfig()` still has it.
  if (extended !== undefined) {
    out.extends = [extended].flat(Infinity).map(item => (typeof item === "string" ? item : serializeConfigObject(item)));
  }
  return out;
}

let exported = (await import(pathToFileURL(path).href)).default;
if (typeof exported === "function") exported = exported();
exported = await exported;
let config = null;
if (Array.isArray(exported)) config = exported.flat(Infinity).map(serializeConfigObject);
else if (exported !== undefined) config = serializeConfigObject(exported);

// A package is as good as its `package.json`, which is written when it is installed.
const files = new Set();
for (const file of [path, ...Object.keys(require.cache), ...touched]) {
  const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(file);
  files.add(match ? resolve(match[1], "package.json") : file);
}
process.stdout.write(marker + JSON.stringify({ config, files: [...files], environment: [...environment], uncacheable }));
