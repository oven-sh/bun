// Evaluates an `eslint.config.*` and prints it as the JSON that `Config::from_flat_json` reads. The
// format is described in `mod.rs`.
//
//   bun serialize-eslint-config.mjs <path of the configuration file>

import { pathToFileURL } from "node:url";

const unserializable = what => ({ $unserializable: what });

/** `name@version` of a parser, a plugin or a processor, as ESLint's `getObjectId`. */
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
  if (parserOptions !== undefined) {
    // A parser among the options of another one, as `vue-eslint-parser` has it.
    const { parser: inner, programs, ...options } = parserOptions;
    out.parserOptions = serialize(options);
    if (inner !== undefined)
      out.parserOptions.parser = typeof inner === "string" ? inner : ((inner && objectId(inner)) ?? serialize(inner));
    if (programs) out.parserOptions.programs = true;
  }
  return out;
}

export function serializeConfigObject(config) {
  if (config === null || typeof config !== "object") return serialize(config) ?? null;
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  if (plugins && typeof plugins === "object") {
    out.plugins = Object.fromEntries(
      Object.entries(plugins).map(([prefix, plugin]) => [prefix, (plugin && objectId(plugin)) ?? null]),
    );
  }
  if (languageOptions && typeof languageOptions === "object")
    out.languageOptions = serializeLanguageOptions(languageOptions);
  if (processor !== undefined)
    out.processor = typeof processor === "string" ? processor : ((processor && objectId(processor)) ?? "unknown");
  // Only a file that does not call `defineConfig()` still has it.
  if (extended !== undefined)
    out.extends = [extended]
      .flat(Infinity)
      .map(item => (typeof item === "string" ? item : serializeConfigObject(item)));
  return out;
}

export function serializeConfig(config) {
  return [config].flat(Infinity).map(serializeConfigObject);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const module = await import(pathToFileURL(process.argv[2]).href);
  process.stdout.write(JSON.stringify(serializeConfig(await (module.default ?? module))));
}
