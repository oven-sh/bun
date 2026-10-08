// Prints what an `eslint.config.*` or an `oxlint.config.ts` exports as the JSON that
// `bun_lint::linter::Config::from_flat_json` documents.

const unserializable = what => ({ $unserializable: what });

// `name@version` of a parser, a plugin or a processor: ESLint's `getObjectId`.
function objectId(object) {
  const name = object.name ?? object.meta?.name;
  if (typeof name !== "string" || !name) return null;
  const version = object.version ?? object.meta?.version;
  return typeof version === "string" && version ? `${name}@${version}` : name;
}

// How a worker for JavaScript plugins gets hold of a plugin: `{ module, export }`, the file of a module that is loaded and
// the path to the plugin in what it exports. `null` if there is no such module: then it is where the configuration has it.
const located = new Map();
function locate(plugin) {
  if (located.size === 0) {
    for (const [module, { exports }] of Object.entries(require.cache)) {
      const note = (value, path) => {
        if (value !== null && typeof value === "object" && !located.has(value)) located.set(value, { module, export: path });
      };
      try {
        note(exports, []);
        for (const [name, value] of Object.entries(exports ?? {})) {
          note(value, [name]);
          if (name === "default") for (const [inner, it] of Object.entries(value ?? {})) note(it, [name, inner]);
        }
      } catch {}
    }
  }
  return located.get(plugin) ?? null;
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

function serializeConfigObject(config, index) {
  if (config === null || typeof config !== "object") return serialize(config) ?? null;
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  if (plugins && typeof plugins === "object") {
    const ids = Object.entries(plugins).map(([prefix, plugin]) => [prefix, (plugin && objectId(plugin)) ?? null]);
    out.plugins = Array.isArray(plugins) ? serialize(plugins) : Object.fromEntries(ids);
    const withRules = Object.entries(plugins).filter(([, plugin]) => plugin?.rules && Object.keys(plugin.rules).length > 0);
    // `index`: that of the object in what the file exports.
    out.$jsPlugins = Object.fromEntries(withRules.map(([prefix, plugin]) => [prefix, locate(plugin) ?? { config: path, index }]));
  }
  if (languageOptions && typeof languageOptions === "object") {
    out.languageOptions = serializeLanguageOptions(languageOptions);
  }
  if (processor !== undefined) {
    out.processor = typeof processor === "string" ? processor : ((processor && objectId(processor)) ?? "unknown");
  }
  // Only a file that does not call `defineConfig()` still has it.
  if (extended !== undefined) {
    out.extends = [extended].flat(Infinity).map(item => (typeof item === "string" ? item : serializeConfigObject(item, index)));
  }
  return out;
}

let exported = (await import(pathToFileURL(path).href)).default;
if (typeof exported === "function") exported = exported();
exported = await exported;
let config = null;
if (Array.isArray(exported)) config = exported.flat(Infinity).map(serializeConfigObject);
else if (exported !== undefined) config = serializeConfigObject(exported, 0);

finish(config);
