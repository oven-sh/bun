// Loads what a configuration file of ESLint 8 names and only a program can get at: a file that is a program itself, the packages
// that `extends` names, plugins, parsers. It prints them as JSON, with all that these name in turn, so that one run is enough for
// a file. It goes through a file as `ConfigArrayFactory` of `@eslint/eslintrc` does, and loads nothing that this does not load.
// What becomes of it all is decided in `bun_lint::linter::Config::from_legacy`.
//
// `{ files, configs, plugins, parsers }`:
// - `files[path]`: what the file that the script is run for says. `null`: nothing.
// - `configs[from][request]`: `{ path, config }`, what `extends` in the file `from` names.
// - `plugins[pluginsFrom][request]`: `{ path, name, configs, environments, processors, location }`. See `LegacyKind::Plugin`.
// - `parsers[from][request]`: `{ name, path, location }`, `location` being what `$parser` of a flat configuration has. One that is
//   read here is looked for and not loaded: it has no `location`.
// - `rules`: `{ location }`, the rules of `--rulesdir`, if the script is run for that.
// `path`, `from` and `pluginsFrom` are absolute and have `/`.
//
// In place of each: `{ $error, $missing }`, why it cannot be used: `message` of the error that `ConfigArrayFactory` has then, before
// it says who names it. `$missing`: nothing is found by the name. See `LegacyFailure`.

const { createRequire } = require("node:module");
const nodePath = require("node:path");

// `pluginsFrom`: the directory that plugins are looked for from. `content`: what the file says, if it is none that can be read.
// `cwd`: the working directory of the run, which is that of the programs. `rulesdir`: what `--rulesdir` names. It comes with a
// `content` that names nothing.
const { pluginsFrom, content, cwd, rulesdir } = JSON.parse(process.argv.at(-3));
if (cwd !== undefined) process.chdir(cwd);
// Any text can be a key.
const map = () => ({ __proto__: null });
const out = { files: map(), configs: map(), plugins: { [pluginsFrom]: map() }, parsers: map() };
// What has `key` in `all`, which is made if it is not there.
const section = (all, key) => (all[key] ??= map());

// `naming.normalizePackageName`
function normalizePackageName(name, prefix) {
  const normalized = name.replaceAll("\\", "/");
  if (normalized[0] !== "@") return normalized.startsWith(`${prefix}-`) ? normalized : `${prefix}-${normalized}`;
  const shortcut = new RegExp(`^(@[^/]+)(?:/(?:${prefix})?)?$`, "u");
  if (shortcut.test(normalized)) return normalized.replace(shortcut, `$1/${prefix}`);
  if (new RegExp(`^${prefix}(-|$)`, "u").test(normalized.split("/")[1])) return normalized;
  return normalized.replace(/^@([^/]+)\/(.*)$/u, `@$1/${prefix}-$2`);
}

// `naming.getShorthandName`
function shorthandName(name, prefix) {
  if (name[0] !== "@") return name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : name;
  const match = new RegExp(`^(@[^/]+)/${prefix}(?:-(.+))?$`, "u").exec(name);
  if (!match) return name;
  return match[2] === undefined ? match[1] : `${match[1]}/${match[2]}`;
}

const isFilePath = name => /^\.{1,2}[/\\]/u.test(name) || nodePath.isAbsolute(name);
const textOf = error => String(error?.message ?? error);
const isMissing = error => error?.code === "MODULE_NOT_FOUND";
// What is missing today can be installed tomorrow, and no file that is here changes with that.
const why = (text, $missing) => (giveUp(), { $error: text, $missing });
// `ModuleResolver.resolve`. `from`: a file, with `/`.
const resolveFrom = (request, from) => createRequire(resolve(from)).resolve(request);
const portable = file => portablePath(file, nodePath);

// ESLint reads a configuration by its properties, whatever it is an instance of.
const record = (value, inside = []) =>
  value === null || typeof value !== "object" || value instanceof RegExp || inside.includes(value)
    ? value
    : Array.isArray(value)
      ? value.map(item => record(item, [...inside, value]))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, record(item, [...inside, value])]));
const print = value => serialize(record(value));

// `strip-json-comments`: white space in their place.
const withoutComments = text =>
  text.replace(/\\\\|\\"|"(?:\\[^]?|[^"\\])*(?:"|$)|\/\/[^\n]*|\/\*[^]*?(?:\*\/|$)/g, it =>
    it[0] === "/" ? it.replace(/\S/g, " ") : it,
  );

// `loadConfigFile`
function read(file) {
  const text = () => fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
  let before = "";
  try {
    switch (nodePath.extname(file)) {
      case ".js":
      case ".cjs":
        return require(file);
      case ".json": {
        before = `Failed to read JSON file at ${file}:\n\n`;
        const data = JSON.parse(withoutComments(text()));
        before = "";
        if (nodePath.basename(file) !== "package.json") return data;
        if (!Object.hasOwn(data, "eslintConfig"))
          throw new Error("package.json file doesn't have 'eslintConfig' field.");
        return data.eslintConfig;
      }
      case ".yaml":
      case ".yml":
        return Bun.YAML.parse(text()) || {};
      default:
        return Bun.YAML.parse(withoutComments(text())) || {};
    }
  } catch (error) {
    throw new Error(`${before}Cannot read config file: ${file}\nError: ${textOf(error)}`);
  }
}

// `@rushstack/eslint-patch/modern-module-resolution`, which configurations that are packages load (`eslint-config-next`,
// `eslint-config-react-app`), changes the ESLint that has loaded it, and throws where there is none. What it changes is done
// here: from then on a plugin is looked for from the file that names it, and only then from where ESLint looks.
let looksFromTheFile = false;
Bun.plugin({
  name: "@rushstack/eslint-patch",
  setup: build =>
    void build.module("@rushstack/eslint-patch/modern-module-resolution", () => {
      looksFromTheFile = true;
      return { exports: {}, loader: "object" };
    }),
});
// `eslint-plugin-html` changes the `Linter` that it finds among the modules that are loaded, and throws if there is none.
class Linter {
  verify() {}
}
require.cache[nodePath.join(pluginsFrom, "node_modules", "eslint", "lib", "linter", "linter.js")] = {
  exports: { Linter },
};

// The rules of version 8 of typescript-eslint are all implemented here, and to load it is to load TypeScript: of that version only
// the configurations are loaded, which are modules of their own. `file`: its main module.
function configsOfTypescript(file) {
  let version;
  try {
    ({ version } = require(resolveFrom("@typescript-eslint/eslint-plugin/package.json", file)));
  } catch {}
  if (!(parseInt(version, 10) >= 8)) return null;
  return name => {
    for (const directory of ["configs/eslintrc", "configs"]) {
      try {
        return require(nodePath.join(file, "..", directory, `${name}.js`));
      } catch {}
    }
    return require(file).configs?.[name];
  };
}

// `_loadPlugin`. `from`: the file that names it.
function plugin(name, from) {
  const request = normalizePackageName(name, "eslint-plugin");
  const plugins = out.plugins[pluginsFrom];
  if (Object.hasOwn(plugins, request)) return plugins[request];
  // What `extend` adds to is kept apart from what the plugin has.
  const found = (plugins[request] = { configs: map() });
  const fail = (text, $missing) => Object.assign(found, why(text, $missing));
  if (isFilePath(name)) return fail("Plugins array cannot includes file paths.");
  if (/\s/u.test(name)) return fail(`Whitespace found in plugin name '${name}'`);
  let file;
  try {
    if (looksFromTheFile) file = resolveFrom(request, from);
  } catch {}
  try {
    file ??= resolveFrom(request, nodePath.join(pluginsFrom, "__placeholder__.js"));
  } catch (error) {
    return fail(textOf(error), isMissing(error) || undefined);
  }
  try {
    // Not printed.
    const hide = (key, value) => Object.defineProperty(found, key, { value });
    hide("file", file);
    hide("config", request === "@typescript-eslint/eslint-plugin" ? configsOfTypescript(file) : null);
    const loaded = found.config ? {} : require(file);
    if (!found.config) hide("loaded", loaded);
    found.path = portable(file);
    found.name = objectId(loaded) ?? request;
    found.environments = print(loaded.environments || {});
    found.processors = Object.keys(loaded.processors || {});
  } catch (error) {
    fail(textOf(error));
  }
  return found;
}

// `_loadExtends`. `from`: the file that has `name` in `extends`.
function extend(name, from) {
  if (name.startsWith("eslint:")) return;
  if (name.startsWith("plugin:")) {
    const slash = name.lastIndexOf("/");
    const [pluginName, configName] = [name.slice("plugin:".length, slash), name.slice(slash + 1)];
    if (slash < 0 || isFilePath(pluginName)) return;
    const found = plugin(pluginName, from);
    if (Object.hasOwn(found.configs, configName)) return;
    const config = found.config ? found.config(configName) : found.loaded?.configs?.[configName];
    if (!config) return;
    found.configs[configName] = print(config);
    visit(config, found.path);
    return;
  }
  const request = isFilePath(name)
    ? name
    : name.startsWith(".")
      ? `./${name}`
      : normalizePackageName(name, "eslint-config");
  const configs = section(out.configs, from);
  if (Object.hasOwn(configs, request)) return;
  configs[request] = {};
  let file;
  try {
    file = resolveFrom(request, from);
  } catch (error) {
    configs[request] = why(textOf(error), isMissing(error) || undefined);
    return;
  }
  try {
    const config = read(file);
    configs[request] = { path: portable(file), config: print(config) };
    visit(config, portable(file));
  } catch (error) {
    configs[request] = why(textOf(error));
  }
}

// Those that are read here: they are looked for and not loaded. So is the copy of Babel's that `eslint-config-next` has.
const knownParsers = ["espree", "@typescript-eslint/parser", "@babel/eslint-parser", "babel-eslint"];
const parserOfNext = /[\\/]eslint-config-next[\\/]parser\.js$/u;

// `_loadParser`. `from`: the file that names it.
function parser(name, from) {
  const parsers = section(out.parsers, from);
  if (Object.hasOwn(parsers, name)) return;
  let file;
  try {
    file = resolveFrom(name, from);
  } catch (error) {
    // ESLint has one.
    parsers[name] = name === "espree" ? { name } : why(textOf(error), isMissing(error) || undefined);
    return;
  }
  const isOfNext = parserOfNext.test(file);
  parsers[name] = { name: isOfNext ? "eslint-config-next/parser" : name, path: portable(file) };
  if (isOfNext || knownParsers.includes(name)) return;
  try {
    const loaded = require(file);
    const entries = Object.entries(loaded);
    const values = entries.map(([key, value]) => [key, typeof value === "function" ? undefined : asJson(value)]);
    parsers[name].name = objectId(loaded) ?? name;
    // `describeParser` in `evaluate-eslint.js`
    parsers[name].location = {
      module: file,
      export: [],
      functions: entries.filter(([, value]) => typeof value === "function").map(([key]) => key),
      values: Object.fromEntries(values.filter(([, value]) => value !== undefined)),
    };
  } catch (error) {
    parsers[name] = why(textOf(error));
  }
}

// `_normalizeObjectConfigDataBody`: loads what `config`, which is in the file `from`, names.
function visit(config, from) {
  if (config === null || typeof config !== "object") return;
  for (const name of [config.extends].flat()) if (name && typeof name === "string") extend(name, from);
  if (config.parser && typeof config.parser === "string") parser(config.parser, from);
  if (Array.isArray(config.plugins)) {
    for (const name of config.plugins) if (typeof name === "string") plugin(name, from);
  }
  if (Array.isArray(config.overrides)) for (const item of config.overrides) visit(item, from);
}

let top = content;
if (top === undefined) {
  try {
    top = read(path);
    // `loadInDirectory` passes over it.
    out.files[path] = top ? print(top) : null;
  } catch (error) {
    out.files[path] = why(textOf(error));
  }
}
visit(top, path);

// `describe` for ESLint 8, not written as JSON yet. There `schema` can be beside `meta`, a rule without one takes any options, as
// does one that is a function, and `meta.defaultOptions` means nothing.
function describeForEslint8(name, plugin) {
  const described = JSON.parse(describe(name, plugin));
  for (const rule of described.rules) {
    const found = plugin.rules[rule.name];
    const { schema, meta } = typeof found === "function" ? {} : (found ?? {});
    rule.schema = asJson(schema || meta?.schema) ?? false;
    delete rule.defaultOptions;
  }
  return described;
}

// After all are loaded: it says which module exports a rule.
for (const [request, found] of Object.entries(out.plugins[pluginsFrom])) {
  try {
    if (Object.keys(found.loaded?.rules ?? {}).length === 0) continue;
    const described = stringify(describeForEslint8(shorthandName(request, "eslint-plugin"), found.loaded));
    found.location = { module: found.file, export: [], described };
  } catch (error) {
    Object.assign(found, why(textOf(error)));
  }
}

// ───────────── `--rulesdir` ─────────────

// `loadRules` for each of `directories`, which are absolute: every `.js` file in one is a rule that is called as the file, and is
// loaded whether or not a configuration has the rule. Of two with the same name the later counts. ESLint makes a plugin without a
// name of them all. `{ location }`, as a plugin has it: `rules` are the files by the names of the rules, since no module exports
// that plugin.
function rulesIn(directories) {
  const [rules, files] = [map(), map()];
  for (const directory of directories.map(it => resolve(it))) {
    for (const name of fs.readdirSync(directory)) {
      if (nodePath.extname(name) !== ".js") continue;
      const [id, file] = [name.slice(0, -3), nodePath.join(directory, name)];
      try {
        rules[id] = require(file);
      } catch (error) {
        throw new Error(`${file}: ${textOf(error)}`);
      }
      files[id] = file;
    }
  }
  // What exports nothing is no rule.
  for (const id of Object.keys(rules).filter(id => !rules[id])) {
    delete rules[id];
    delete files[id];
  }
  const described = describeForEslint8("", { rules });
  for (const rule of described.rules) rule.at = { module: files[rule.name], export: [] };
  return { location: { rules: files, described: stringify(described) } };
}

if (rulesdir !== undefined) {
  try {
    out.rules = rulesIn(rulesdir);
  } catch (error) {
    out.rules = why(textOf(error));
  }
}

finish(out);
