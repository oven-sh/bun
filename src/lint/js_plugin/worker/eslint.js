// ───────────── ESLint's own `Linter` ─────────────
//
// A file for which an `eslint.config.js` has a `language` other than JavaScript, or a parser that makes a tree of its own, is linted
// by the `Linter` of the `eslint` that the project has installed. It is given a configuration that is made here, of what the other
// side has found to be configured for the file and of the few objects that this takes: the parser, the plugin that has the
// language, the rules that are on. The configuration file is not run.

const LINT_WITH_ESLINT = 20;
const CONFIGURE_ESLINT = 21;

const NEEDS_ESLINT_CONFIGURATION = "4";
const NOT_INSTALLED = "5";

// By the directory that it is looked for from: `{ Linter, FlatConfigArray }`, or `null` if it is not installed. `FlatConfigArray`,
// which the package does not export, is `null` if it is not where it has been since ESLint 8.21.
const eslintPackages = new Map();

function eslintFrom(directory) {
  let found = eslintPackages.get(directory);
  if (found !== undefined) return found;
  const started = performance.now();
  const from = createRequire(nodePath.join(directory, "noop.js"));
  let root = null;
  try {
    root = nodePath.dirname(from.resolve("eslint/package.json"));
  } catch {}
  found = null;
  if (root !== null) {
    found = { Linter: from("eslint").Linter, FlatConfigArray: null };
    try {
      found.FlatConfigArray =
        require(nodePath.join(root, "lib", "config", "flat-config-array.js")).FlatConfigArray ?? null;
    } catch {}
  }
  loadingTime += performance.now() - started;
  eslintPackages.set(directory, found);
  return found;
}

// What stands for the plugin at `location` in a configuration. `rules`: by their names, the modules that export the rules
// themselves. The plugin is loaded for what else is asked of it. `loaded`: it is loaded already.
function pluginFor(location, rules, loaded) {
  let plugin = loaded;
  const whole = () => {
    if (plugin === undefined) {
      plugin = null;
      // Not one that only the configuration file has, or that awaits something: these are loaded before.
      if (location.module !== undefined) plugin = ruleAt(location) ?? null;
    }
    return plugin;
  };
  const ruleCalled = name => (Object.hasOwn(rules, name) ? ruleAt(rules[name]) : undefined) ?? whole()?.rules?.[name];
  return {
    get meta() {
      return whole()?.meta;
    },
    get languages() {
      return whole()?.languages;
    },
    get processors() {
      return whole()?.processors;
    },
    rules: new Proxy({}, { get: (_, name) => ruleCalled(name), has: (_, name) => ruleCalled(name) !== undefined }),
  };
}

// ESLint's `normalizePackageName(name, "eslint-plugin")`.
function longPluginName(name) {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("@")) {
    if (/^@[^/]+$/u.test(normalized)) return `${normalized}/eslint-plugin`;
    const [scope, rest] = normalized.split("/");
    return rest.startsWith("eslint-plugin") ? normalized : `${scope}/eslint-plugin-${rest}`;
  }
  return normalized.startsWith("eslint-plugin-") ? normalized : `eslint-plugin-${normalized}`;
}

// An object that the command line adds to the configuration. Its plugins and its parser are names.
async function reviveOverride(object) {
  const resolve = createRequire(nodePath.join(cwd, "noop.js")).resolve;
  const importFrom = async name => load(pathToFileURL(resolve(name)).href);
  const revived = { ...object };
  if (object.plugins !== undefined) {
    revived.plugins = {};
    for (const [prefix, name] of Object.entries(object.plugins)) {
      const module = await importFrom(longPluginName(name));
      if (!("default" in module)) {
        throw new Error(
          `"${longPluginName(name)}" cannot be used with the \`--plugin\` option because its default module does not provide a \`default\` export`,
        );
      }
      revived.plugins[prefix] = module.default;
    }
  }
  if (typeof object.languageOptions?.parser === "string") {
    const module = await importFrom(object.languageOptions.parser);
    revived.languageOptions = { ...object.languageOptions, parser: module.default ?? module };
  }
  return revived;
}

// ESLint's `calculateConfigArray`: all of the configuration file, for a file whose configuration has what only JavaScript can say.
// `file`: `null` under `--no-config-lookup`.
async function wholeConfiguration({ FlatConfigArray }, { file, basePath, ignores, added }) {
  // Of an array that is only an array the `Linter` makes one for each file.
  const configs = FlatConfigArray === null ? [] : new FlatConfigArray([], { basePath, shouldIgnore: ignores });
  if (file !== null) {
    // It can be a promise, as that of @antfu/eslint-config.
    const exported = await (await load(pathToFileURL(file).href)).default;
    if (Array.isArray(exported)) configs.push(...exported);
    else if (exported !== undefined) configs.push(exported);
  }
  for (const object of added) configs.push(await reviveOverride(object));
  await configs.normalize?.();
  if (configs.getConfig === undefined) return configs;
  return Object.assign([], { getConfig: name => withoutProcessor(configs.getConfig(name)) });
}

// By configuration: the same without its `processor`.
const withoutProcessors = new WeakMap();

// The other side calls the processors, as it does for the files that it lints itself: the `Linter` would call them once more.
function withoutProcessor(config) {
  if (config?.processor === undefined) return config;
  if (!withoutProcessors.has(config)) {
    const get = (_, key) => {
      const value = key === "processor" ? undefined : config[key];
      return typeof value === "function" ? value.bind(config) : value;
    };
    withoutProcessors.set(config, new Proxy(config, { get }));
  }
  return withoutProcessors.get(config);
}

// The configuration of a file. `object`: what is configured for it, as far as that is JSON. `plugins`: by prefix
// `{ location, rules, isNeeded }`.
async function builtConfiguration({ FlatConfigArray }, { basePath }, { object, parser, plugins }) {
  const config = { ...object, files: [() => true], plugins: {} };
  // What is as it is without being said is not said: ESLint knows `reportUnusedInlineConfigs` since 9.19, `language` since 9.5.
  const { reportUnusedInlineConfigs, ...linterOptions } = object.linterOptions;
  if (reportUnusedInlineConfigs === 0) config.linterOptions = linterOptions;
  if (object.language === "@/js") delete config.language;
  for (const [prefix, { location, rules, isNeeded }] of Object.entries(plugins)) {
    const loaded = isNeeded ? await locatedPlugin(location, prefix) : undefined;
    config.plugins[prefix] = pluginFor(location, rules, loaded);
  }
  if (parser !== null)
    config.languageOptions = { ...object.languageOptions, parser: await locatedPlugin(parser, null) };
  if (FlatConfigArray === null) return [config];
  const configs = new FlatConfigArray([config], { basePath });
  await configs.normalize();
  const merged = configs.getConfig(nodePath.join(basePath, "file"));
  // The `Linter` only asks for the configuration of the file.
  return Object.assign([], { getConfig: () => merged });
}

// By id: `{ linter, configs, options }`.
const eslintConfigurations = new Map();

// `run`: what is the same for all files of a configuration file. `built`: `null` if the file needs all of that.
async function configureEslint([id, run, built]) {
  const eslint = eslintFrom(run.from);
  if (eslint === null) return NOT_INSTALLED;
  const started = performance.now();
  const configs = await (built === null ? wholeConfiguration(eslint, run) : builtConfiguration(eslint, run, built));
  loadingTime += performance.now() - started;
  eslintConfigurations.set(id, { linter: new eslint.Linter({ cwd, configType: "flat" }), configs, options: run });
  return DONE;
}

// ESLint's `getShorthandName(name, "eslint-plugin")`.
function shortPluginName(name) {
  if (name.startsWith("@")) {
    const whole = /^(@[^/]+)\/eslint-plugin$/u.exec(name);
    if (whole) return whole[1];
    const scoped = /^(@[^/]+)\/eslint-plugin-(.+)$/u.exec(name);
    return scoped ? `${scoped[1]}/${scoped[2]}` : name;
  }
  return name.startsWith("eslint-plugin-") ? name.slice("eslint-plugin-".length) : name;
}

// `config.getRuleDefinition(ruleId)`, which the configurations of ESLint have since 9.24: before, its `getRuleFromConfig`.
function ruleDefinition(config, ruleId) {
  if (config.getRuleDefinition !== undefined) return config.getRuleDefinition(ruleId);
  const slash = ruleId.lastIndexOf("/");
  return config.plugins?.[slash === -1 ? "@" : ruleId.slice(0, slash)]?.rules?.[ruleId.slice(slash + 1)];
}

// ESLint's `getOrFindUsedDeprecatedRules`, by the configuration of a file.
const usedDeprecatedRules = new WeakMap();

function deprecatedRulesOf(config) {
  let used = usedDeprecatedRules.get(config);
  if (used !== undefined) return used;
  used = [];
  for (const [ruleId, setting] of Object.entries(config.rules ?? {})) {
    const severity = Array.isArray(setting) ? setting[0] : setting;
    if (severity === 0 || severity === "off") continue;
    const meta = ruleDefinition(config, ruleId)?.meta;
    if (!meta?.deprecated) continue;
    const isObject = typeof meta.deprecated === "object";
    let replacedBy = meta.replacedBy || [];
    if (isObject) {
      const replacements = Array.isArray(meta.deprecated.replacedBy) ? meta.deprecated.replacedBy : [];
      replacedBy = replacements.map(it => {
        if (typeof it !== "object" || it === null) return "";
        const plugin = it.plugin?.name;
        const rule = it.rule?.name;
        return `${typeof plugin === "string" ? `${shortPluginName(plugin)}/` : ""}${typeof rule === "string" ? rule : ""}`;
      });
    }
    used.push({ ruleId, replacedBy, info: isObject ? meta.deprecated : undefined });
  }
  usedDeprecatedRules.set(config, used);
  return used;
}

const WITHOUT_FIXES = 1;

// ESLint's `verifyText`, without the fixing, which the other side does. The message: `flags`, the id of the configuration, the length
// of the path and of what it starts with that is the path of the file on disk, then the path, then the text.
function lintWithEslint() {
  const length = ask(MESSAGE);
  const buffer = buffers[MESSAGE];
  const [flags, id, pathLength, physicalLength] = new Uint32Array(buffer, 0, 4);
  const configuration = eslintConfigurations.get(id);
  if (configuration === undefined) return NEEDS_ESLINT_CONFIGURATION;
  const { linter, configs, options } = configuration;
  const name = decode(buffer, 16, 16 + pathLength);
  const how = {
    allowInlineConfig: options.allowInlineConfig,
    filename: name,
  };
  if (configs.getConfig !== undefined) how.filterCodeBlock = block => configs.getConfig(block) !== undefined;
  if (options.onlyErrors) how.ruleFilter = ({ severity }) => severity === 2;
  if (physicalLength !== pathLength) how.physicalFilename = decode(buffer, 16, 16 + physicalLength);
  if ((flags & WITHOUT_FIXES) !== 0) how.disableFixes = true;
  const messages = linter.verify(decode(buffer, 16 + pathLength, length), configs, how);
  const config = configs.getConfig?.(name);
  return (
    DONE +
    JSON.stringify([messages, linter.getSuppressedMessages(), config === undefined ? [] : deprecatedRulesOf(config)])
  );
}

// What `handle` does with the kinds of calls from `LINT_WITH_ESLINT` on.
function handleForEslint(kind) {
  const failed = error => FAILED + String(error?.message ?? error);
  try {
    return kind === LINT_WITH_ESLINT ? lintWithEslint() : configureEslint(askForJson(MESSAGE)).catch(failed);
  } catch (error) {
    return failed(error);
  }
}
