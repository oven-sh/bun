// Prints what an `eslint.config.*` or an `oxlint.config.ts` exports as the JSON that
// `bun_lint::linter::Config::from_flat_json` documents.

// The plugins of all objects, by the prefix of what is in them: `{ plugin, index }`.
const pluginsByPrefix = new Map();

// How a worker gets hold of a processor: `{ plugin, prefix, name }` for one that a plugin has, `plugin` being where that is,
// `{ object }` for one that a module exports, `{ config, index }` for one that only the object of the configuration has.
// `null`: there is no such processor.
function locateProcessor(processor, index) {
  if (typeof processor !== "string") {
    const object = locateDeep(processor);
    return object === null ? { config: path, index } : { object };
  }
  const parts = processor.split("/");
  const name = parts.pop();
  const prefix = parts.join("/");
  const found = pluginsByPrefix.get(prefix);
  if (found?.plugin?.processors?.[name] === undefined) return null;
  return { plugin: locateDeep(found.plugin) ?? { config: path, index: found.index }, prefix, name };
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

// What a worker has to know of a parser to stand in for it until a rule calls it: `module` and `export`, the module that exports
// it, if there is one, the names of its functions, and what else it has that is JSON.
function describeParser(parser) {
  const entries = Object.entries(parser);
  const values = entries.map(([name, value]) => [name, typeof value === "function" ? undefined : asJson(value)]);
  return {
    ...locateDeep(parser),
    functions: entries.filter(([, value]) => typeof value === "function").map(([name]) => name),
    values: Object.fromEntries(values.filter(([, value]) => value !== undefined)),
  };
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
    return { basePath: predicate.basePath, $ignorePatterns: patterns };
  }
  return config;
}

function serializeConfigObject(given, index) {
  if (given === null || typeof given !== "object") return serialize(given) ?? null;
  const config = withoutMatchers(given);
  const { plugins, languageOptions, processor, extends: extended, ...rest } = config;
  const out = serialize(rest);
  if (typeof out.basePath === "string") out.basePath = portablePath(out.basePath, require("node:path"));
  // Which object this is of what the file exports: a worker takes from there what JSON cannot say.
  if (rest.settings !== undefined) out.$source = { config: path, index };
  if (plugins && typeof plugins === "object") {
    const ids = Object.entries(plugins).map(([prefix, plugin]) => [prefix, (plugin && objectId(plugin)) ?? null]);
    out.plugins = Array.isArray(plugins) ? serialize(plugins) : Object.fromEntries(ids);
    const withRules = Object.entries(plugins).filter(
      ([, plugin]) => Object.keys(plugin?.rules ?? {}).length > 0 || Object.keys(plugin?.languages ?? {}).length > 0,
    );
    // eslint-plugin-html has nothing in it: to load it changes the `Linter`, which then finds the scripts in a file.
    const changesLinter = plugin => /[\\/]eslint-plugin-html[\\/]/.test(locateDeep(plugin)?.module ?? "");
    if (Object.values(plugins).some(changesLinter)) out.$changesLinter = true;
    // `index`: that of the object in what the file exports.
    out.$jsPlugins = Object.fromEntries(
      withRules.map(([prefix, plugin]) => [
        prefix,
        // `else`: the file itself can have put it where it was found.
        {
          ...(locateDeep(plugin) ?? { config: path, index }),
          else: { config: path, index },
          described: describedOnce(prefix, plugin),
        },
      ]),
    );
  }
  if (languageOptions && typeof languageOptions === "object") {
    out.languageOptions = serializeLanguageOptions(languageOptions);
    if (languageOptions.parser) out.$parser = describeParser(languageOptions.parser);
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

const isOfVite = require("node:path").basename(path).startsWith("vite.config.");
let exported = (await import(pathToFileURL(path).href)).default;
if (typeof exported === "function")
  exported = isOfVite ? exported({ command: "serve", mode: "development" }) : exported();
exported = await exported;
// Vite+: what `vp lint` reads.
if (isOfVite) exported = exported?.lint ?? null;
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
