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
      wrapped.set(plugin, candidate);
      return where;
    }
  }
  return null;
}

// By what `fixupPluginRules` has made: what of.
const wrapped = new Map();

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
// The rules are in the order in which a worker numbers them. `at`: the module that exports the very rule, if there is one. A worker
// loads that, and not the plugin with all its other rules.
function describe(name, plugin) {
  locate(plugin);
  const original = wrapped.get(plugin) ?? plugin;
  const rules = Object.keys(plugin.rules)
    .sort()
    .map(ruleName => {
      const meta = plugin.rules[ruleName]?.meta;
      return {
        name: ruleName,
        at: locate(original.rules[ruleName]) ?? undefined,
        type: meta?.type,
        fixable: Boolean(meta?.fixable),
        hasSuggestions: meta?.hasSuggestions === true,
        schema: asJson(meta?.schema),
        defaultOptions: asJson(meta?.defaultOptions),
      };
    });
  return stringify({ name, rules });
}

// The plugins of all objects, by the prefix of what is in them: `{ plugin, index }`.
const pluginsByPrefix = new Map();

// How a worker gets hold of a processor: `{ plugin, prefix, name }` for one that a plugin has, `plugin` being where that is,
// `{ object }` for one that a module exports, `{ config, index }` for one that only the object of the configuration has.
// `null`: there is no such processor.
function locateProcessor(processor, index) {
  if (typeof processor !== "string") {
    const object = locate(processor);
    return object === null ? { config: path, index } : { object };
  }
  const parts = processor.split("/");
  const name = parts.pop();
  const prefix = parts.join("/");
  const found = pluginsByPrefix.get(prefix);
  if (found?.plugin?.processors?.[name] === undefined) return null;
  return { plugin: locate(found.plugin) ?? { config: path, index: found.index }, prefix, name };
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
  // Options of rules have them. A worker makes it again.
  if (value instanceof RegExp) return { $regexp: [value.source, value.flags] };
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

// ───────────── `FlatCompat` ─────────────
//
// `FlatCompat` of `@eslint/eslintrc` makes a function in `files` of the `files` and `excludedFiles` of each of the `overrides` of
// what it is given, and one function in `ignores` of all `ignorePatterns`. What they are made of is found by calling them once.

// Calls `matcher`, and returns the `OverrideTester`s that it asks and the configurations that it has computed.
function probe(matcher) {
  const seen = { testers: [], configs: [] };
  const undo = [];
  for (const { exports } of Object.values(require.cache)) {
    let legacy;
    try {
      legacy = exports?.Legacy;
    } catch {}
    const tester = legacy?.OverrideTester?.prototype;
    const array = legacy?.ConfigArray?.prototype;
    if (typeof tester?.test !== "function" || typeof array?.extractConfig !== "function") continue;
    if (undo.some(it => it.tester === tester)) continue;
    const { test } = tester;
    const { extractConfig } = array;
    undo.push({ tester, test, array, extractConfig });
    // To compute a configuration asks testers too.
    let isInside = false;
    tester.test = function (...args) {
      if (!isInside) seen.testers.push(this);
      return Reflect.apply(test, this, args);
    };
    array.extractConfig = function (...args) {
      isInside = true;
      try {
        const config = Reflect.apply(extractConfig, this, args);
        seen.configs.push(config);
        return config;
      } finally {
        isInside = false;
      }
    };
  }
  try {
    matcher(resolve(path, "..", "__placeholder__.js"));
  } catch {
  } finally {
    for (const { tester, test, array, extractConfig } of undo) {
      tester.test = test;
      array.extractConfig = extractConfig;
    }
  }
  return seen;
}

// `convertIgnorePatternToMinimatch` of `@eslint/compat`.
function ignorePatternToMinimatch(pattern) {
  const negation = pattern.startsWith("!") ? "!" : "";
  const tested = pattern.slice(negation.length).trimEnd();
  if (["", "**", "/**", "**/"].includes(tested)) return negation + tested;
  const slash = tested.indexOf("/");
  const everywhere = slash < 0 || slash === tested.length - 1 ? "**/" : "";
  const escaped = (slash === 0 ? tested.slice(1) : tested).replaceAll(/(?=((?:\\.|[^{(])*))\1([{(])/guy, "$1\\$2");
  return negation + everywhere + escaped + (tested.endsWith("/**") ? "/*" : "");
}

// `config` without the functions of `FlatCompat` in `files` and `ignores`. Any other function stays.
function withoutMatchers(config) {
  const isMatcher = it => typeof it === "function";
  const { files, ignores } = config;
  if (Array.isArray(files) && files.length === 1 && isMatcher(files[0]) && ignores === undefined) {
    const { testers, configs } = probe(files[0]);
    if (testers.length !== 1 || configs.length !== 0 || config.basePath !== undefined) return config;
    // minimatch's `matchBase`
    const glob = ({ pattern, options }) => (options.matchBase && !pattern.includes("/") ? `**/${pattern}` : pattern);
    // Of each of the overrides that this is in, one has to match.
    let all = [[]];
    const excluded = [];
    for (const { includes, excludes } of testers[0].patterns) {
      if (includes) all = all.flatMap(before => includes.map(it => [...before, glob(it)]));
      if (excludes) excluded.push(...excludes.map(glob));
    }
    if (all.some(it => it.length === 0)) return config;
    const recovered = {
      ...config,
      basePath: testers[0].basePath,
      files: all.map(it => (it.length === 1 ? it[0] : it)),
    };
    if (excluded.length > 0) recovered.ignores = excluded;
    return recovered;
  }
  if (Array.isArray(ignores) && ignores.length === 1 && isMatcher(ignores[0]) && Object.keys(config).length === 1) {
    const { configs } = probe(ignores[0]);
    const predicate = configs.length === 1 ? configs[0]?.ignores : undefined;
    if (typeof predicate?.basePath !== "string" || !Array.isArray(predicate.patterns)) return config;
    // `DotPatterns`, which it ignores besides.
    const patterns = [".*", "!.eslintrc.*", ...predicate.patterns];
    return { basePath: predicate.basePath, ignores: patterns.map(ignorePatternToMinimatch) };
  }
  return config;
}

function serializeConfigObject(given, index) {
  if (given === null || typeof given !== "object") return serialize(given) ?? null;
  const config = withoutMatchers(given);
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  // `basePath` is read with `/`.
  if (typeof out.basePath === "string" && process.platform === "win32")
    out.basePath = out.basePath.replaceAll("\\", "/");
  // Which object this is of what the file exports: a worker takes from there what JSON cannot say.
  if (rest.settings !== undefined) out.$source = { config: path, index };
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
    out.$processor = locateProcessor(processor, index);
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
[exported].flat(Infinity).forEach((object, index) => {
  for (const [prefix, plugin] of Object.entries(object?.plugins ?? {})) {
    if (!pluginsByPrefix.has(prefix)) pluginsByPrefix.set(prefix, { plugin, index });
  }
});
let config = null;
if (Array.isArray(exported)) config = exported.flat(Infinity).map(serializeConfigObject);
else if (exported !== undefined) config = serializeConfigObject(exported, 0);

finish(config);
