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
        if (value !== null && typeof value === "object" && !located.has(value))
          located.set(value, { module, export: path });
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
  return located.get(plugin) ?? locateWrapped(plugin);
}

// `fixupPluginRules` of the `@eslint/compat` that the configuration has loaded, if it has.
let fixupPluginRules = null;

// Where the plugin is that `fixupPluginRules` has made `plugin` of. What it adds to a rule is for an ESLint without the methods
// of ESLint 8, and the workers have these: the plugin runs as it is, and the configuration file need not be run to get at it.
function locateWrapped(plugin) {
  if (fixupPluginRules === null || !plugin?.rules) return null;
  const names = Object.keys(plugin.rules).join();
  for (const [candidate, where] of located) {
    // It answers with what it has made of a plugin before.
    if (candidate.rules && Object.keys(candidate.rules).join() === names && fixupPluginRules(candidate) === plugin) {
      return where;
    }
  }
  return null;
}

// JSON, or `undefined` for what is not.
function asJson(value) {
  try {
    return JSON.parse(stringify(value));
  } catch {
    return undefined;
  }
}

// `JSON.stringify` that keeps an infinite number, which default options have: as a number too large for a double.
function stringify(value) {
  let hasInfinity = false;
  const json = JSON.stringify(value, (_, it) => {
    if (it !== Infinity && it !== -Infinity) return it;
    hasInfinity = true;
    return it > 0 ? "\0+Infinity" : "\0-Infinity";
  });
  return hasInfinity
    ? json.replace(/"\\u0000([+-])Infinity"/g, (_, sign) => (sign === "+" ? "1e999" : "-1e999"))
    : json;
}

// What the linter has to know of a plugin before any of its rules runs, as JSON: `plugin_of` in `js_plugin/host.rs` reads it.
// The rules are in the order in which a worker numbers them.
function describe(name, plugin) {
  const rules = Object.keys(plugin.rules)
    .sort()
    .map(ruleName => {
      const meta = plugin.rules[ruleName]?.meta;
      return {
        name: ruleName,
        type: meta?.type,
        fixable: Boolean(meta?.fixable),
        hasSuggestions: meta?.hasSuggestions === true,
        schema: asJson(meta?.schema),
        defaultOptions: asJson(meta?.defaultOptions),
      };
    });
  return stringify({ name, rules });
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

// Many objects have the same plugins: only the first says what is in one.
const described = new Set();
function describedOnce(prefix, plugin) {
  if (described.has(prefix)) return undefined;
  described.add(prefix);
  return describe(prefix, plugin);
}

function serializeConfigObject(config, index) {
  if (config === null || typeof config !== "object") return serialize(config) ?? null;
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  if (plugins && typeof plugins === "object") {
    const ids = Object.entries(plugins).map(([prefix, plugin]) => [prefix, (plugin && objectId(plugin)) ?? null]);
    out.plugins = Array.isArray(plugins) ? serialize(plugins) : Object.fromEntries(ids);
    const withRules = Object.entries(plugins).filter(
      ([, plugin]) => plugin?.rules && Object.keys(plugin.rules).length > 0,
    );
    // `index`: that of the object in what the file exports.
    out.$jsPlugins = Object.fromEntries(
      withRules.map(([prefix, plugin]) => [
        prefix,
        { ...(locate(plugin) ?? { config: path, index }), described: describedOnce(prefix, plugin) },
      ]),
    );
  }
  if (languageOptions && typeof languageOptions === "object") {
    out.languageOptions = serializeLanguageOptions(languageOptions);
  }
  if (processor !== undefined) {
    out.processor = typeof processor === "string" ? processor : ((processor && objectId(processor)) ?? "unknown");
  }
  // Only a file that does not call `defineConfig()` still has it.
  if (extended !== undefined) {
    out.extends = [extended]
      .flat(Infinity)
      .map(item => (typeof item === "string" ? item : serializeConfigObject(item, index)));
  }
  return out;
}

let exported = (await import(pathToFileURL(path).href)).default;
if (typeof exported === "function") exported = exported();
exported = await exported;
const compat = Object.keys(require.cache).find(file => /[\\/]@eslint[\\/]compat[\\/]dist[\\/]/.test(file));
if (compat !== undefined) fixupPluginRules = (await import(pathToFileURL(compat).href)).fixupPluginRules ?? null;
let config = null;
if (Array.isArray(exported)) config = exported.flat(Infinity).map(serializeConfigObject);
else if (exported !== undefined) config = serializeConfigObject(exported, 0);

finish(config);
