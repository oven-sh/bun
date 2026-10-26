// ------------- ESLint's own `Linter` -------------
//
// A file for which an `eslint.config.js` has a `language` other than JavaScript, or a parser that makes a tree of its own, is linted
// by the `Linter` of the `eslint` that the project has installed. It is given a configuration that is made here, of what the other
// side has found to be configured for the file and of the few objects that this takes: the parser, the plugin that has the
// language, the rules that are on. The configuration file is not run.

const LINT_WITH_ESLINT = 20;
const CONFIGURE_ESLINT = 21;

const NEEDS_ESLINT_CONFIGURATION = "4";
const NOT_INSTALLED = "5";
// What ESLint throws while the rules that only it runs lint a file for the other side, when the rules are traced: the
// id of the rule it was setting up, or nothing once every rule is set up, then a line break, then the message.
const THROWN_BY_RULES = "8";

// Keyed by the directory it's looked up from: `{ Linter, FlatConfigArray, traverses }`, or `null` if it isn't
// installed. `FlatConfigArray`, which the package doesn't export, is `null` if it isn't where it has been since ESLint
// 8.21. `traverses` is true if its `Linter` says when every rule is set up (`hookTraversal`).
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
    found = { Linter: from("eslint").Linter, FlatConfigArray: null, traverses: false };
    try {
      found.FlatConfigArray =
        require(nodePath.join(root, "lib", "config", "flat-config-array.js")).FlatConfigArray ?? null;
    } catch {}
    try {
      const traverser = require(nodePath.join(root, "lib", "linter", "source-code-traverser.js")).SourceCodeTraverser;
      found.traverses = hookTraversal(traverser?.prototype);
    } catch {}
  }
  loadingTime += performance.now() - started;
  eslintPackages.set(directory, found);
  return found;
}

// The prototypes of ESLint's `SourceCodeTraverser` whose `traverseSync` is hooked. The `runRules` of ESLint 10 and late
// 9 (not 9.24) sets up every rule, then traverses with them, so from then on a throw isn't part of a rule's setup.
const hookedTraversals = new WeakSet();

// Returns whether `prototype` has a `traverseSync`, which is then hooked.
function hookTraversal(prototype) {
  const traverse = prototype?.traverseSync;
  if (typeof traverse !== "function") return false;
  if (!hookedTraversals.has(prototype)) {
    hookedTraversals.add(prototype);
    prototype.traverseSync = function (...args) {
      if (reports !== null) settingUp = null;
      return traverse.apply(this, args);
    };
  }
  return true;
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

// Converts a `[[lint.overrides]]` pattern to a `Bun.Glob` pattern, like `Pattern::of_bunfig` in src/glob/pattern.rs.
function bunfigGlob(pattern) {
  // Leading `!`s negate the whole pattern, so they stay in front. The `!` of `!(a|b)` starts a group instead.
  const bangs = /^!*/u.exec(pattern)[0].length;
  const negations = bangs > 0 && pattern[bangs] === "(" ? bangs - 1 : bangs;
  const rest = pattern.slice(negations);
  // A pattern without a slash matches the file name in any directory.
  const anywhere = rest.startsWith("./") ? rest.slice(2) : rest.includes("/") ? rest : `**/${rest}`;
  return pattern.slice(0, negations) + anywhere;
}

// Builds one matcher function from the globs of a `[[lint.overrides]]` entry, which are relative to `base`. ESLint calls it with
// an absolute path. It uses Bun's globs, so these files match the same overrides as the files Bun lints itself.
function bunfigMatcher(patterns, base) {
  const globs = patterns.map(it => new Bun.Glob(bunfigGlob(it)));
  return file => {
    const relative = nodePath.relative(base, file).replaceAll("\\", "/");
    const isInside = relative !== ".." && !relative.startsWith("../") && !nodePath.isAbsolute(relative);
    return isInside && globs.some(it => it.match(relative));
  };
}

// Rewrites an ESLint ignore pattern that is relative to the directory `from` so that it's relative to `to`.
function movedPattern(pattern, from, to) {
  const bang = pattern.startsWith("!") ? "!" : "";
  const rest = pattern.slice(bang.length).replace(/^\.\//u, "");
  const down = nodePath.relative(to, from).replaceAll("\\", "/");
  // A pattern that starts with a slash never matches, whatever it's relative to.
  if (down === "" || rest.startsWith("/")) return pattern;
  if (!down.startsWith("..")) return `${bang}${down}/${rest}`;
  // `to` is below `from`. A pattern that doesn't lead into `to` keeps its `../`, so it matches nothing there.
  const up = `${nodePath.relative(from, to).replaceAll("\\", "/")}/`;
  if (rest.startsWith("**/")) return pattern;
  return rest.startsWith(up) ? bang + rest.slice(up.length) : `${bang}${down}/${rest}`;
}

// Prepares a config object that the command line or bunfig.toml adds. Its plugins and parser arrive as names. Its `basePath` says
// what its patterns are relative to, if that isn't `arrayBase`, the base path of the config array. ESLint only knows `basePath`
// in config objects since 9.30 and rejects unknown keys, so the key is never passed on.
async function reviveOverride(object, arrayBase) {
  const resolve = createRequire(nodePath.join(cwd, "noop.js")).resolve;
  const importFrom = async name => load(pathToFileURL(resolve(name)).href);
  const { $globsOfBun: isOfBunfig, $jsPlugins: located = {}, basePath = arrayBase, ...revived } = object;
  if (isOfBunfig) {
    revived.files = [bunfigMatcher(object.files, basePath)];
    if (object.ignores !== undefined) revived.ignores = [bunfigMatcher(object.ignores, basePath)];
  } else if (object.ignores !== undefined) {
    revived.ignores = object.ignores.map(it => movedPattern(it, basePath, arrayBase));
  }
  if (object.plugins !== undefined) {
    revived.plugins = {};
    for (const [prefix, name] of Object.entries(object.plugins)) {
      if (located[prefix] !== undefined) {
        revived.plugins[prefix] = await locatedPlugin(located[prefix], prefix);
        continue;
      }
      let module;
      try {
        module = await importFrom(longPluginName(name));
      } catch (error) {
        if (error?.code !== "MODULE_NOT_FOUND") throw error;
        throw new Error(
          `${longPluginName(name)} is not installed\n  bun lint has the rules of "${prefix}" built in, but some of your files go to the installed ESLint, which needs the package`,
        );
      }
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
  // The `Linter` turns a plain array into a config array whose base path is its `cwd`.
  const arrayBase = FlatConfigArray === null ? cwd : basePath;
  for (const object of added) configs.push(await reviveOverride(object, arrayBase));
  await configs.normalize?.();
  if (configs.getConfig === undefined) return configs;
  return Object.assign([], { getConfig: name => forLinter(configs.getConfig(name)) });
}

// Keyed by config: the same config as the `Linter` gets it.
const forLinters = new WeakMap();

// The config without its `processor`, and with a parser whose errors keep their `column`. The other side calls the
// processors, as it does for the files it lints itself, so the `Linter` would call them a second time.
function forLinter(config) {
  if (config === undefined) return config;
  if (!forLinters.has(config)) {
    // A language other than JavaScript may take a different kind of `parser`, such as a name.
    const parser = config.languageOptions?.parser;
    const isParser = typeof parser?.parse === "function" || typeof parser?.parseForESLint === "function";
    const languageOptions = isParser
      ? { ...config.languageOptions, parser: withErrorColumns(parser) }
      : config.languageOptions;
    const overrides = { processor: undefined, languageOptions };
    if (typeof config.getRuleDefinition === "function") {
      overrides.getRuleDefinition = ruleId => traced(config.getRuleDefinition(ruleId));
    }
    forLinters.set(config, configWith(config, overrides));
  }
  return forLinters.get(config);
}

// `config` with `overrides`' properties replacing its own, and its own methods bound to it.
function configWith(config, overrides) {
  const get = (_, key) => {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = config[key];
    return typeof value === "function" ? value.bind(config) : value;
  };
  return new Proxy(config, { get });
}

// Set while the rules that only ESLint runs lint a file for the other side, which merges their reports with its own
// rules' reports: keyed by rule and position, for each report in creation order, when ESLint called the listener that
// created it. Otherwise `null`.
let reports = null;
// The listener of the running rule: `{ when, node, selector, ofCodePath }`.
let listening = null;
// While `reports` is set: whether a rule has been traced, whether the `Linter` says when every rule is set up
// (`eslintFrom`'s `traverses`), and the id of the rule whose setup a throw now belongs to, or `null`. ESLint sets a
// rule up from `ruleFilter` on: it creates it, checks what `create` returns and reads the listeners. If the `Linter`
// traverses, all of that ends when traversal starts. Otherwise it ends when `create` returns listeners, which report it
// themselves if reading them throws.
let isTraced = false;
let traverses = false;
let settingUp = null;

// What a rule's message is reported on, which the other side uses to order messages that start at one position
// (`ReportedOn`): `when`, in a listener on entering a node (0), on leaving it (1), at the end of its code path (2), on
// leaving the `Program` (3), or when the `Program`'s code path ends, which ESLint does after all that (4); whether the
// node starts before the message; where the node ends; how many of its ancestors have its range, which ESLint enters
// before it; the listener's key, whose specificity and then text order the listeners of one node (`null` for a code
// path event, which has none); and the listener's position among those called on entering or leaving the node: a code
// path event's (0) before a selector's (1), unless the event ends the node's code path (2).
const ENTERING = 0;
const LEAVING = 1;
const LEAVING_CODE_PATH = 2;
const AT_THE_END = 3;
const AFTER_THE_END = 4;

// The code path events that ESLint calls with the node last, and when.
const CODE_PATH_EVENTS = new Map([
  ["onCodePathStart", ENTERING],
  ["onCodePathEnd", LEAVING_CODE_PATH],
  ["onCodePathSegmentStart", ENTERING],
  ["onCodePathSegmentEnd", LEAVING],
  ["onCodePathSegmentLoop", ENTERING],
  ["onUnreachableCodePathSegmentStart", ENTERING],
  ["onUnreachableCodePathSegmentEnd", LEAVING],
]);

const EVENT = 0;
const SELECTOR = 1;
const ENDING = 2;

// True if ESLint's `CodePathAnalyzer` ends a code path when it leaves `node`, after the `:exit` listeners.
function endsCodePath(node) {
  switch (node.type) {
    case "Program":
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "StaticBlock":
      return true;
    default:
      return node.parent?.type === "PropertyDefinition" && node.parent.value === node;
  }
}

// Keyed by rule: the same rule with listeners that record when they run and reports recorded in `reports`. Only used
// while `reports` is set.
const tracedRules = new WeakMap();

function traced(rule) {
  if (typeof rule?.create !== "function") return rule;
  let found = tracedRules.get(rule);
  if (found === undefined) {
    found = Object.create(rule, { create: { value: context => createTraced(rule, context), enumerable: true } });
    tracedRules.set(rule, found);
  }
  return found;
}

function createTraced(rule, context) {
  if (reports === null) return rule.create(context);
  const ruleId = context.id;
  isTraced = true;
  settingUp = ruleId;
  const report = (...args) => {
    noteReport(ruleId, args, context.sourceCode?.visitorKeys);
    return context.report(...args);
  };
  let listeners;
  try {
    listeners = rule.create(Object.create(context, { report: { value: report } }));
  } catch (error) {
    throw asThrownInCreate(error);
  }
  // ESLint throws itself if `create` returns nothing.
  if (listeners === null || listeners === undefined) return listeners;
  if (!traverses) settingUp = null;
  // ESLint reads the listeners of any other value with `Object.keys`, a function's too.
  if (typeof listeners !== "object" && typeof listeners !== "function") return listeners;
  return tracedListeners(ruleId, listeners);
}

// `listeners` as ESLint reads them, with listeners that record when they run. ESLint enumerates and reads them after
// `create`, and only then asks `listeners` for each key and listener, so a throw then doesn't mean the rule failed to
// load but is part of the setup of the rule `ruleId`. The target is empty, so what `listeners` reports about its
// properties, frozen or not, holds for the proxy.
function tracedListeners(ruleId, listeners) {
  const asked = read => {
    try {
      return read();
    } catch (error) {
      if (reports !== null) settingUp = ruleId;
      throw error;
    }
  };
  return new Proxy(
    {},
    {
      ownKeys: () => asked(() => Reflect.ownKeys(listeners)),
      getOwnPropertyDescriptor: (_, key) =>
        asked(() => {
          const descriptor = Reflect.getOwnPropertyDescriptor(listeners, key);
          return descriptor && { ...descriptor, configurable: true };
        }),
      has: (_, key) => asked(() => Reflect.has(listeners, key)),
      get: (_, key) => asked(() => tracedListener(key, Reflect.get(listeners, key))),
    },
  );
}

function tracedListener(key, listener) {
  if (typeof listener !== "function" || typeof key !== "string") return listener;
  const onCodePath = CODE_PATH_EVENTS.get(key);
  const ofCodePath = onCodePath !== undefined;
  const when = onCodePath ?? (key.endsWith(":exit") ? LEAVING : ENTERING);
  const selector = ofCodePath ? null : key;
  return function (...args) {
    const before = listening;
    settingUp = null;
    listening = { when, node: ofCodePath ? args.at(-1) : args[0], selector, ofCodePath };
    try {
      return listener.apply(this, args);
    } finally {
      listening = before;
    }
  };
}

// What `create` threw, for ESLint's `createRuleListeners`, which sets its `message`. If it isn't an object, setting it
// throws in V8's words, as `thrownInCreate` has them, not JavaScriptCore's.
function asThrownInCreate(error) {
  if (error === undefined || error === null) {
    const said = `Cannot read properties of ${error} (reading 'message')`;
    return {
      get message() {
        throw new TypeError(said);
      },
    };
  }
  if (typeof error === "object" || typeof error === "function") return error;
  const said = `Cannot create property 'message' on ${typeof error} '${String(error)}'`;
  return {
    get message() {
      return undefined;
    },
    set message(_) {
      throw new TypeError(said);
    },
  };
}

// ESLint's `normalizeMultiArgReportCall`, and where the message starts, as its `createProblem` has it.
function reportContext(args, listening, visitorKeys) {
  const descriptor =
    args.length === 1 ? args[0] : typeof args[1] === "string" ? { node: args[0] } : { node: args[0], loc: args[1] };
  const start = descriptor?.loc ? (descriptor.loc.start ?? descriptor.loc) : descriptor?.node?.loc?.start;
  const node = listening?.node;
  if (typeof start?.line !== "number" || !Array.isArray(node?.range) || node.loc === undefined) return;
  const [line, column] = [start.line, start.column + 1];
  const isOuter = node.loc.start.line < line || (node.loc.start.line === line && node.loc.start.column + 1 < column);
  // The `Program`'s code path ends after every `Program:exit` listener.
  const leavesProgram = node.type === "Program" && listening.when !== ENTERING;
  const when = !leavesProgram ? listening.when : listening.ofCodePath ? AFTER_THE_END : AT_THE_END;
  const [from, to] = node.range;
  let nesting = 0;
  for (let it = node.parent; it?.range?.[0] === from && it.range[1] === to; it = it.parent) nesting++;
  const stage = !listening.ofCodePath
    ? SELECTOR
    : listening.when === ENTERING || (listening.when === LEAVING && !endsCodePath(node))
      ? EVENT
      : ENDING;
  return {
    line,
    column,
    on: [when, isOuter ? 1 : 0, node.range[1], nesting, listening.selector, stage, twinOf(node, visitorKeys)],
  };
}

function noteReport(ruleId, args, visitorKeys) {
  const context = reportContext(args, listening, visitorKeys);
  if (!context) return;
  const key = `${ruleId}\n${context.line}\n${context.column}`;
  let noted = reports.get(key);
  if (noted === undefined) reports.set(key, (noted = []));
  noted.push(context.on);
}

// The number of children of `node`'s parent that the traversal visits before it and that have its range: the key of
// `{a}` before its value.
function twinOf(node, visitorKeys) {
  const parent = node.parent;
  const keys = parent ? visitorKeys?.[parent.type] : undefined;
  if (!Array.isArray(keys)) return 0;
  const [from, to] = node.range;
  let twin = 0;
  for (const key of keys) {
    const value = parent[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child === node) return twin;
      if (child?.range?.[0] === from && child.range[1] === to) twin++;
    }
  }
  return 0;
}

// Gives each of `messages` the `reportedOn` of the report that created it: the first unclaimed one of its rule at its
// position.
function addReportedOn(messages) {
  for (const message of messages) {
    if (message.ruleId === null) continue;
    const noted = reports.get(`${message.ruleId}\n${message.line}\n${message.column}`);
    if (noted?.length) message.reportedOn = noted.shift();
  }
}

// Keyed by parser: the same parser, whose errors keep their `column`.
const withErrorColumnsOf = new WeakMap();

function withErrorColumns(parser) {
  if (!withErrorColumnsOf.has(parser)) {
    const methods = {};
    for (const name of ["parse", "parseForESLint"]) {
      const method = parser[name];
      if (typeof method !== "function") continue;
      const value = (...args) => {
        try {
          return method.apply(parser, args);
        } catch (error) {
          unhideColumnGetter(error);
          throw error;
        }
      };
      methods[name] = { value, enumerable: true };
    }
    withErrorColumnsOf.set(parser, Object.create(parser, methods));
  }
  return withErrorColumnsOf.get(parser);
}

// JavaScriptCore gives an error an own `column` the first time its `column`, `line` or `stack` is read. That hides a
// getter on the error's class, such as typescript-estree's `TSError` getter, which ESLint reads for a parsing error's
// position. Reading the descriptor creates the own property, so deleting it exposes the getter for good.
function unhideColumnGetter(error) {
  if (typeof error !== "object" || error === null) return;
  const own = Object.getOwnPropertyDescriptor(error, "column");
  if (own === undefined || !("value" in own) || own.enumerable || !own.configurable) return;
  for (let it = Object.getPrototypeOf(error); it !== null; it = Object.getPrototypeOf(it)) {
    const inherited = Object.getOwnPropertyDescriptor(it, "column");
    if (inherited === undefined) continue;
    if (inherited.get !== undefined) delete error.column;
    return;
  }
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
    await importAll(Object.values(rules).map(it => it.module));
    const loaded = isNeeded ? await locatedPlugin(location, prefix) : undefined;
    config.plugins[prefix] = pluginFor(location, rules, loaded);
  }
  if (parser !== null)
    config.languageOptions = { ...object.languageOptions, parser: await locatedPlugin(parser, null) };
  if (FlatConfigArray === null) return [config];
  const configs = new FlatConfigArray([config], { basePath });
  await configs.normalize();
  const merged = forLinter(configs.getConfig(nodePath.join(basePath, "file")));
  // The `Linter` only asks for the configuration of the file.
  return Object.assign([], { getConfig: () => merged });
}

// Keyed by id: `{ linter, configs, options, traverses }`.
const eslintConfigurations = new Map();

// `run`: what is the same for all files of a configuration file. `built`: `null` if the file needs all of that.
async function configureEslint([id, run, built]) {
  const eslint = eslintFrom(run.from);
  if (eslint === null) return NOT_INSTALLED;
  const started = performance.now();
  const configs = await (built === null ? wholeConfiguration(eslint, run) : builtConfiguration(eslint, run, built));
  loadingTime += performance.now() - started;
  const options = { ...run, aboutLayout: new Set(run.aboutLayout) };
  const linter = new eslint.Linter({ cwd, configType: "flat" });
  eslintConfigurations.set(id, { linter, configs, options, traverses: eslint.traverses });
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
// Only the named rules run, and no comment is reported as unused: the other side merges their reports with its own
// rules' reports, and applies the comments to all of them.
const ONLY = 2;
// None of the running rules reads types, so the parser isn't asked for a TypeScript program.
const WITHOUT_TYPES = 4;

// The parser options that make typescript-eslint build a program.
const TYPED_OPTIONS = ["project", "projectService", "programs"];

// Keyed by config: the same config without the options that create a TypeScript program.
const withoutTypesOf = new WeakMap();

function withoutTypes(config) {
  const parserOptions = config?.languageOptions?.parserOptions;
  if (parserOptions === undefined || !TYPED_OPTIONS.some(it => parserOptions[it])) return config;
  if (!withoutTypesOf.has(config)) {
    const untyped = { ...parserOptions };
    for (const key of TYPED_OPTIONS) delete untyped[key];
    const languageOptions = { ...config.languageOptions, parserOptions: untyped };
    withoutTypesOf.set(config, configWith(config, { languageOptions }));
  }
  return withoutTypesOf.get(config);
}

// Whether a message is of one of the rules `aboutLayout`, or says that a comment which disables nothing but them does nothing.
function isAboutLayout({ ruleId, message }, aboutLayout) {
  if (ruleId !== null) return aboutLayout.has(ruleId);
  const names =
    /^Unused eslint-\w+ directive \(.* (?:from|for) ('.*')\)\.$/u.exec(message)?.[1].match(/'[^']+'/gu) ?? [];
  return names.length > 0 && names.every(it => aboutLayout.has(it.slice(1, -1)));
}

// ESLint's `verifyText`, without the fixing, which the other side does. The message: `flags`, the id of the configuration, the length
// of the path, of its prefix that is the file's path on disk and of the names of the rules that run, then the path,
// then those names, each followed by a line break, then the text.
function lintWithEslint() {
  const { 0: flags, 1: id, 2: pathLength, 3: physicalLength, 4: namesLength } = messageWords(5);
  const configuration = eslintConfigurations.get(id);
  if (configuration === undefined) return NEEDS_ESLINT_CONFIGURATION;
  const { linter, options } = configuration;
  let { configs } = configuration;
  const name = messageText(20, 20 + pathLength);
  const how = {
    allowInlineConfig: options.allowInlineConfig,
    filename: name,
  };
  if ((flags & WITHOUT_TYPES) !== 0 && configs.getConfig !== undefined) {
    const typed = configs;
    configs = Object.assign([], { getConfig: name => withoutTypes(typed.getConfig(name)) });
  }
  if (configs.getConfig !== undefined) how.filterCodeBlock = block => configs.getConfig(block) !== undefined;
  // The rules about layout do not run here either.
  const isRun = ({ ruleId, severity }) => !options.aboutLayout.has(ruleId) && (!options.onlyErrors || severity === 2);
  how.ruleFilter = isRun;
  let only = null;
  if ((flags & ONLY) !== 0) {
    only = new Set(messageText(20 + pathLength, 20 + pathLength + namesLength).split("\n"));
    how.ruleFilter = it => {
      const runs = only.has(it.ruleId) && isRun(it);
      // ESLint asks right before it sets the rule up, including a rule that has no `create` to trace.
      if (runs) settingUp = it.ruleId;
      return runs;
    };
    how.reportUnusedDisableDirectives = "off";
    traverses = configuration.traverses;
  }
  if (physicalLength !== pathLength) how.physicalFilename = messageText(20, 20 + physicalLength);
  if ((flags & WITHOUT_FIXES) !== 0) how.disableFixes = true;
  // The `Linter` of ESLint 8 knows no `ruleFilter`: there they have run.
  const isKept = it =>
    !isAboutLayout(it, options.aboutLayout) && (only === null || it.ruleId === null || only.has(it.ruleId));
  if (only !== null) reports = new Map();
  let messages, suppressed;
  try {
    messages = linter.verify(messageText(20 + pathLength + namesLength), configs, how).filter(isKept);
    suppressed = linter.getSuppressedMessages().filter(isKept);
    if (only !== null) {
      addReportedOn(messages);
      addReportedOn(suppressed);
    }
  } catch (error) {
    // ESLint before 9.24 has no rule to trace, so the other side only gets the message.
    if (!isTraced) throw error;
    return THROWN_BY_RULES + (settingUp ?? "") + "\n" + messageOf(error);
  } finally {
    reports = null;
    listening = null;
    isTraced = false;
    traverses = false;
    settingUp = null;
  }
  const config = configs.getConfig?.(name);
  return DONE + JSON.stringify([messages, suppressed, config === undefined ? [] : deprecatedRulesOf(config)]);
}

// What `handle` does with the kinds of calls from `LINT_WITH_ESLINT` on.
function handleForEslint(kind) {
  const failed = error => FAILED + messageOf(error);
  try {
    return kind === LINT_WITH_ESLINT ? lintWithEslint() : configureEslint(askForJson(MESSAGE)).catch(failed);
  } catch (error) {
    return failed(error);
  }
}
