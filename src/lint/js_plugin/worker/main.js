// Portions of this file are copied from ESLint, which is under the MIT License:
//
// Copyright OpenJS Foundation and other contributors, <www.openjsf.org>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// ------------- the program -------------
//
// It is the body of a function of `require`, of `load`, which is `import()`, and of `native`: the functions of
// src/jsc/bindings/Lint*.cpp. With `native.askText(kind, details, start, end)` and `native.askWords(kind, details, count)` it asks the
// other side for something and reads the answer where it is.
//
// It returns `handle`, which the other side calls. See `wire.rs` for what is said. All of it is synchronous but for loading
// a plugin.

// The program is ASCII, so that it's parsed as one byte per character. It loads no module that it may not need: each costs millions
// of instructions in every realm.
const { pathToFileURL } = Bun;
const nodeModule = require("node:module");
const { createRequire } = nodeModule;
const nodePath = require("node:path");
const { realpathSync } = require("node:fs");

// Rules ask which modules are built in, to tell them from packages. They mean Node.js, where `undici` and `ws` are packages. The
// same is in `evaluate-start.js`.
{
  const isOfBun = name => /^bun(?::|$)/.test(name) || name === "undici" || name === "ws";
  const { isBuiltin } = nodeModule;
  nodeModule.builtinModules = nodeModule.builtinModules.filter(name => !isOfBun(name));
  nodeModule.isBuiltin = name => !isOfBun(name) && isBuiltin(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// What a plugin has thrown, as text. To read it runs code of the plugin, which can throw again.
function messageOf(error, read = it => it?.message ?? it) {
  try {
    return String(read(error));
  } catch (second) {
    try {
      return String(second?.message ?? second);
    } catch {
      return "An exception was thrown.";
    }
  }
}

// oxlint's `getErrorMessage`, without the stack frames: V8's `error.stack` starts with `String(error)`.
function saidByOxlint(error) {
  try {
    if (error instanceof Error) return Error.prototype.toString.call(error);
  } catch {}
  return "Unknown error";
}

// ESLint's `createRuleListeners` catches what `create` throws and puts the rule into its message: the other side does that where
// the line is "create". `ex.message = ..` throws itself if `ex` is no object, and these are V8's words for it.
function thrownInCreate(error) {
  if (error === undefined || error === null)
    return [null, `Cannot read properties of ${error} (reading 'message')`, null];
  if (typeof error !== "object" && typeof error !== "function") {
    return [null, `Cannot create property 'message' on ${typeof error} '${String(error)}'`, null];
  }
  return [currentRule.position, messageOf(error, it => `${it.message}`), "create"];
}

const LOAD = 1;
const LINT = 2;
const LOAD_SETTINGS = 3;

const DONE = "0";
const FAILED = "1";
const NEEDS_PLUGINS = "2";
const NEEDS_SETTINGS = "6";

// The content of the message that is being handled.
const MESSAGE = 0;
const START = 1;
const SETTINGS = 2;
const CONFIGURED = 3;
const SELECTORS = 4;
const LOADED = 10;

// What `evaluate-eslint.js` has written for a `RegExp`, and `write_option` for `NaN`.
const revive = (_, value) =>
  Array.isArray(value?.$regexp) ? new RegExp(...value.$regexp) : value?.$number === "NaN" ? NaN : value;

// The first `count` words of the message that is being handled.
function messageWords(count) {
  return native.askWords(MESSAGE, "", count);
}

// The text that the bytes from `start` to `end` of it are in UTF-8. Without `end`: to where it ends.
function messageText(start, end) {
  return native.askText(MESSAGE, "", start, end);
}

function askForJson(kind, details) {
  const json = native.askText(kind, details);
  return json.includes('"$regexp"') || json.includes('"$number"') ? JSON.parse(json, revive) : JSON.parse(json);
}

// ------------- plugins -------------

let cwd = "";
// The rules of the plugins that are loaded: `{ plugin, name }`, by the number that the other side knows them by.
const rules = [];
// The positions of the plugins whose rules are in `rules`.
const loadedPlugins = new Set();
// By where they are, as JSON: `{ name, plugin }` of the plugins that were ever loaded.
const pluginsByLocation = new Map();

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
    ? // A quote inside a string has a backslash before it.
      json.replace(/(?<=^|[[,:])"\\u0000([+-])Infinity"/g, (_, sign) => (sign === "+" ? "1e999" : "-1e999"))
    : json;
}

// What the configuration files that were needed to find a plugin export, by their paths.
const configurations = new Map();

// What is at `path` in what a module exports. Of an ES module that exports something as "module.exports", `require` returns only
// that, which is also what it exports as `default`.
function exportedAt(exported, path) {
  let found = exported;
  for (const name of path) {
    const inner = found?.[name];
    if (inner !== undefined || name !== "default") found = inner;
  }
  return found;
}

// The plugin that an `eslint.config.js` has under `prefix`, and that is where `evaluate-eslint.js` says.
async function locatedPlugin(location, prefix) {
  // `--rulesdir`: a file for each rule, and no module that exports them all.
  if (location.rules !== undefined) {
    return { rules: Object.fromEntries(Object.entries(location.rules).map(([name, file]) => [name, require(file)])) };
  }
  if (location.module !== undefined) {
    // As `require.cache` has it, which is where it was found.
    let found;
    try {
      found = require(location.module);
    } catch {
      // A module that awaits something.
      found = await load(pathToFileURL(location.module).href);
    }
    found = exportedAt(found, location.export);
    // The configuration file can have put it there: `merge(...tseslint.configs.recommended, other)` changes what the module exports.
    if ((found !== null && typeof found === "object") || location.else === undefined) return found;
    return locatedPlugin(location.else, prefix);
  }
  let exported = configurations.get(location.config);
  if (exported === undefined) {
    exported = (await load(pathToFileURL(location.config).href)).default;
    if (typeof exported === "function") exported = exported();
    exported = [await exported].flat(Infinity);
    configurations.set(location.config, exported);
  }
  return exported[location.index].plugins[prefix];
}

const isPathOfPlugin = specifier => /^\.{0,2}[\\/]/u.test(specifier) || nodePath.isAbsolute(specifier);

// The file that `specifier` is: a path, relative to `directory`, or a package that is looked for from there.
function fileOfPlugin(directory, specifier) {
  const wanted = isPathOfPlugin(specifier) ? nodePath.resolve(directory, specifier) : specifier;
  let file;
  try {
    file = createRequire(nodePath.join(directory, "noop.js")).resolve(wanted);
  } catch (error) {
    // A package that can only be imported.
    try {
      file = Bun.resolveSync(wanted, directory);
    } catch {
      throw error;
    }
  }
  // `fs` is what it is called.
  if (!nodePath.isAbsolute(file)) throw new Error(`Cannot find module '${specifier}'`);
  // One file is one plugin, however it is written.
  return realpathSync(file);
}

async function findPlugin([directory, specifier, alias]) {
  const isLocated = typeof directory === "object";
  const isPath = isLocated || isPathOfPlugin(specifier);
  let plugin, file, path;
  if (isLocated) plugin = await locatedPlugin(directory, alias);
  else {
    file = fileOfPlugin(directory, specifier);
    const module = await load(pathToFileURL(file).href);
    plugin = module.default ?? module;
    // Where it is in what `require` returns: that is what is asked where a plugin is located.
    let required;
    try {
      required = require(file);
    } catch {}
    path = required === plugin ? [] : ["default"];
  }
  if (plugin === null || typeof plugin !== "object") {
    throw new TypeError(`A plugin must export an object: ${JSON.stringify(alias ?? specifier)}`);
  }
  // The other side takes `eslint-plugin-` and the like off a name that is no alias.
  let name = alias;
  if (name === null && plugin.meta?.name != null) {
    if (typeof plugin.meta.name !== "string") throw new TypeError("`plugin.meta.name` must be a string if defined");
    name = plugin.meta.name;
  }
  if (name === null && !isPath) name = specifier;
  if (name === null) {
    throw new Error(
      "Plugin must either define `meta.name`, be loaded from an NPM package with a `name` field in `package.json`, or be given an alias in config",
    );
  }
  // `vue` is a package too, and no plugin.
  const hasNothing = !["meta", "rules", "configs", "processors", "languages"].some(key => key in plugin);
  return { name, isAlias: alias !== null, plugin, file, path, hasNothing };
}

// Where the objects are that the modules which are loaded export: `{ module, export }`, as `locate` in `evaluate-eslint.js` has it.
function exportedObjects() {
  const exported = new Map();
  for (const [module, { exports }] of Object.entries(require.cache)) {
    const note = (value, path) => {
      if (value !== null && typeof value === "object" && !exported.has(value))
        exported.set(value, { module, export: path });
    };
    try {
      note(exports, []);
      for (const [name, value] of Object.entries(exports ?? {})) note(value, [name]);
    } catch {}
  }
  return exported;
}

// Why the last module of a rule could not be loaded.
let whyNoRule = "";

// What `lint` returns if there is something in `toImport`.
const NEEDS_MODULES = Symbol("modules");

// The modules that `import()` has been given, and those that it is still to be given.
const imported = new Set();
let toImport = [];

// `require()` of an ES module fails where `import()` does not: if a CommonJS module that it imports requires another ES module that
// it imports too, as the rules of eslint-plugin-import-x do with `eslint` and `debug`. And what has failed once fails again. After
// `import()` it only looks the module up.
async function importAll(modules) {
  const started = performance.now();
  for (const module of modules) imported.add(module);
  await Promise.allSettled(modules.map(module => load(pathToFileURL(module).href)));
  loadingTime += performance.now() - started;
}

// The rule that is there. `undefined`: it cannot be had without its plugin.
function ruleAt(location) {
  const started = performance.now();
  whyNoRule = "";
  try {
    return exportedAt(require(location.module), location.export);
  } catch (error) {
    whyNoRule = ` ${location.module}: ${messageOf(error)}`;
    return undefined;
  } finally {
    loadingTime += performance.now() - started;
  }
}

// For `position`: the file is asked for, and nothing is loaded.
const ONLY_RESOLVE = -1;

// `position`, `firstRule`: `null` as long as the other side does not know the plugin.
async function loadPlugin([location, position, firstRule]) {
  if (position === ONLY_RESOLVE) return { file: fileOfPlugin(location[0], location[1]) };
  const key = JSON.stringify(location);
  let found = pluginsByLocation.get(key);
  if (found === undefined) {
    const started = performance.now();
    pluginsByLocation.set(key, (found = await findPlugin(location)));
    loadingTime += performance.now() - started;
  }
  const { name, isAlias, plugin, file, path, hasNothing } = found;
  const described = [];
  const exported = position === null ? exportedObjects() : null;
  // Sorted: a plugin that imports its rules all at once has them in another order each time.
  const names = Object.keys(plugin.rules ?? {}).sort();
  names.forEach((ruleName, i) => {
    // A plugin can load a rule when it is asked for it.
    if (position !== null) rules[firstRule + i] = { plugin, name: ruleName };
    else {
      const rule = plugin.rules[ruleName];
      if (rule === null || (typeof rule !== "object" && typeof rule !== "function")) {
        throw new TypeError(`The rule ${JSON.stringify(ruleName)} must be an object: ${rule}`);
      }
      const meta = rule.meta;
      described.push({
        name: ruleName,
        at: exported.get(rule),
        type: meta?.type,
        fixable: Boolean(meta?.fixable),
        hasSuggestions: meta?.hasSuggestions === true,
        schema: asJson(meta?.schema),
        defaultOptions: asJson(meta?.defaultOptions),
        deprecated: asJson(meta?.deprecated) || undefined,
        replacedBy: asJson(meta?.replacedBy),
      });
    }
  });
  if (position !== null) loadedPlugins.add(position);
  // ESLint's `getObjectId`
  const { name: called, version } = plugin.meta ?? {};
  const id =
    typeof called !== "string" || !called
      ? null
      : typeof version === "string" && version
        ? `${called}@${version}`
        : called;
  return { name, isAlias, id, file, export: path, hasNothing, rules: described };
}

// ------------- ESLint's `context` -------------

// The text of the file, without the byte order mark.
let text = "";
// ESLint's `SourceCode`: src/jsc/bindings/LintSourceCode.cpp. What a `sourceCode` says is about the file that is being linted.
const SourceCode = native.sourceCode(native.TokenStore, [
  program,
  scopeManager,
  () => fileSettings.languageOptions.parserOptions,
  oxlintScopeManager,
]);
let sourceCode = new SourceCode();
let filename = "";
// The file on the disk, if `filename` is that of a block which a processor has found in it.
let physicalFilename = "";
// `{ settings, languageOptions, freezes }` of the file. `freezes`: rules cannot change these or their options, as in oxlint.
let fileSettings = null;
const allSettings = new Map();
// By id: a rule with its options. `own`: what its contexts have of their own.
const configured = new Map();

const isNonArrayObject = value => typeof value === "object" && value !== null && !Array.isArray(value);

// ESLint's `deepMerge`.
function deepMerge(first, second) {
  const result = { ...first, ...second };
  delete result.__proto__;
  for (const key of Object.keys(second)) {
    if (key === "__proto__" || !Object.prototype.propertyIsEnumerable.call(first, key)) continue;
    if (!isNonArrayObject(first[key])) continue;
    if (isNonArrayObject(second[key])) result[key] = deepMerge(first[key], second[key]);
    else if (second[key] === undefined) result[key] = first[key];
  }
  return result;
}

// Settings with something in them that JSON cannot say, like a function: `settings.settings` is merged again, of the objects
// `sources` of the configuration file.
async function loadSettings([id, settings, sources]) {
  const started = performance.now();
  let merged = {};
  for (const { config, index } of sources) merged = deepMerge(merged, (await configObjects(config))[index].settings);
  loadingTime += performance.now() - started;
  allSettings.set(id, { ...settings, settings: merged });
  addParser(settings);
  return DONE;
}

// Where the parser of ESLint itself is, of the `eslint` that is installed.
function espreePath() {
  try {
    const eslint = createRequire(nodePath.join(cwd, "noop.js")).resolve("eslint/package.json");
    return createRequire(eslint).resolve("espree");
  } catch {
    return undefined;
  }
}

// `languageOptions.parser`, with which a rule parses another file than the one that is linted. `parser`: `null`, or what
// `describeParser` in `evaluate-eslint.js` says about it. It is loaded when one of its functions is called.
function addParser({ languageOptions, parser: known }) {
  let loaded;
  if (known === null) {
    const load = path => (path === undefined ? null : require(path));
    const get = () => (loaded ??= load(espreePath())) ?? undefined;
    Object.defineProperty(languageOptions, "parser", { get, enumerable: true, configurable: true });
    return;
  }
  // One that only the configuration file has cannot be called.
  const names = known.module === undefined ? [] : known.functions;
  const functions = names.map(name => [name, (...args) => (loaded ??= ruleAt(known))[name](...args)]);
  languageOptions.parser = { ...known.values, ...Object.fromEntries(functions) };
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// `settings`, which are those of a configuration of oxlint, for a file. `kind`: see `source_type_for_oxlint` in ../host.rs. oxlint decides
// these for each file.
const settingsByKind = new WeakMap();
function settingsFor(settings, kind) {
  let known = settingsByKind.get(settings);
  if (known === undefined) settingsByKind.set(settings, (known = []));
  if (known[kind] === undefined) {
    const sourceType = ["module", "script", "commonjs"][kind & 3];
    const ecmaFeatures = {
      jsx: (kind & 4) === 0,
      globalReturn: sourceType === "commonjs",
      impliedStrict: sourceType === "module",
    };
    const { languageOptions } = settings;
    const parserOptions = { ...languageOptions.parserOptions, sourceType, ecmaFeatures };
    known[kind] = deepFreeze({ ...settings, languageOptions: { ...languageOptions, sourceType, parserOptions } });
  }
  return known[kind];
}

// oxlint's `context.languageOptions`: one object for all files. What differs between files is behind getters, which answer for the
// file being linted.
const oxlintLanguageOptions = once(() => {
  const ecmaFeatures = Object.freeze({
    get jsx() {
      return fileSettings.languageOptions.parserOptions.ecmaFeatures.jsx;
    },
    get globalReturn() {
      return fileSettings.languageOptions.parserOptions.ecmaFeatures.globalReturn;
    },
    get impliedStrict() {
      return fileSettings.languageOptions.parserOptions.ecmaFeatures.impliedStrict;
    },
  });
  const parserOptions = Object.freeze({
    get sourceType() {
      return fileSettings.languageOptions.sourceType;
    },
    ecmaFeatures,
  });
  const VisitorKeys = native.visitorKeys(2);
  let syntax = null;
  const parser = Object.freeze({
    name: "oxlint",
    // The version of oxlint whose plugin API this is.
    version: "1.87.0",
    parse(_code, _options) {
      throw new Error("`context.languageOptions.parser.parse` not implemented yet.");
    },
    VisitorKeys,
    get Syntax() {
      if (syntax === null) {
        syntax = Object.create(null);
        for (const key of Object.keys(VisitorKeys)) syntax[key] = key;
        Object.freeze(syntax);
      }
      return syntax;
    },
    latestEcmaVersion: 17,
    supportedEcmaVersions: Object.freeze([3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
  });
  return Object.freeze({
    get sourceType() {
      return fileSettings.languageOptions.sourceType;
    },
    ecmaVersion: 2026,
    parser,
    parserOptions,
    get globals() {
      return fileSettings.languageOptions.globals;
    },
    get env() {
      return fileSettings.languageOptions.env;
    },
  });
});

// What a context had until ESLint 9, which plugins still ask for.
const oldContext = {
  get parserOptions() {
    return fileSettings.freezes ? oxlintLanguageOptions().parserOptions : fileSettings.languageOptions.parserOptions;
  },
  // Only a configuration for ESLint 8 has it.
  get parserPath() {
    return fileSettings.isLegacy ? (fileSettings.parser?.module ?? espreePath() ?? "espree") : undefined;
  },
  get parserServices() {
    return sourceCode.parserServices;
  },
  getCwd() {
    return cwd;
  },
  getFilename() {
    return filename;
  },
  getPhysicalFilename() {
    return physicalFilename;
  },
  getSourceCode() {
    return sourceCode;
  },
  getAncestors() {
    return sourceCode.getAncestors(currentNode);
  },
  getDeclaredVariables(node) {
    return sourceCode.getDeclaredVariables(node);
  },
  getScope() {
    return sourceCode.getScope(currentNode);
  },
  markVariableAsUsed(name) {
    return sourceCode.markVariableAsUsed(name, currentNode);
  },
  // ESLint 8's `DEPRECATED_SOURCECODE_PASSTHROUGHS`. With all of what ESLint 8 has, `@eslint/compat` adds nothing.
  getSource: (...args) => sourceCode.getText(...args),
  getSourceLines: () => sourceCode.getLines(),
  ...Object.fromEntries(
    [
      "getAllComments",
      "getNodeByRangeIndex",
      "getComments",
      "getCommentsBefore",
      "getCommentsAfter",
      "getCommentsInside",
      "getJSDocComment",
      "getFirstToken",
      "getFirstTokens",
      "getLastToken",
      "getLastTokens",
      "getTokenAfter",
      "getTokenBefore",
      "getTokenByRangeStart",
      "getTokens",
      "getTokensAfter",
      "getTokensBefore",
      "getTokensBetween",
    ].map(name => [name, (...args) => sourceCode[name](...args)]),
  ),
};

// ESLint's `FileContext`: what all rules see of a file. There is one for each file, and the contexts of the rules inherit from it.
class FileContext {
  constructor() {
    this.cwd = cwd;
    this.filename = filename;
    this.physicalFilename = physicalFilename;
    this.sourceCode = sourceCode;
    this.languageOptions = fileSettings.languageOptions;
    this.settings = fileSettings.settings;
    Object.freeze(this);
  }

  extend(extension) {
    return Object.freeze(Object.assign(Object.create(this), extension));
  }
}
for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(oldContext))) {
  Object.defineProperty(FileContext.prototype, key, { ...descriptor, enumerable: false });
}

// That of oxlint is one for all files, since `createOnce` gets its context once: what it has is always that of the file being linted.
const oxlintFileContext = Object.freeze(
  Object.defineProperties(
    {
      get cwd() {
        return cwd;
      },
      get filename() {
        return filename;
      },
      get physicalFilename() {
        return physicalFilename;
      },
      get sourceCode() {
        return sourceCode;
      },
      get settings() {
        return fileSettings.settings;
      },
      get languageOptions() {
        return oxlintLanguageOptions();
      },
      extend: FileContext.prototype.extend,
    },
    Object.getOwnPropertyDescriptors(oldContext),
  ),
);

// The rule with its options that has `id`, and is at `position` among those that run on the file. Or the position of its plugin,
// which has to be loaded first. Or `null`: its module is among `toImport`.
function configure(id, position) {
  const { 0: index, 1: options, 2: ruleId, 3: location, 4: pluginPosition } = askForJson(CONFIGURED, String(position));
  const ofPlugin = rules[index];
  if (ofPlugin === undefined && location && !imported.has(location.module)) {
    toImport.push(location.module);
    return null;
  }
  const found = ofPlugin !== undefined ? ofPlugin.plugin.rules[ofPlugin.name] : location && ruleAt(location);
  if (found === undefined || found === null) {
    if (loadedPlugins.has(pluginPosition))
      throw new Error(`The plugin no longer has the rule '${ruleId}'.${whyNoRule}`);
    return pluginPosition;
  }
  // A function is a rule without `meta`, as for ESLint until version 8.
  const rule = typeof found === "function" ? { create: found } : found;
  // `once`: what oxlint's `createOnce` has returned, which is called the first time the rule runs.
  // `reporter`: `{ position, meta, report }`, where `report` is `context.report`. See src/jsc/bindings/LintReport.cpp.
  const entry = { rule, ruleId, own: null, position: 0, once: null, reporter: native.reporter(rule.meta) };
  entry.own = {
    id: ruleId,
    // ESLint leaves them as they are, and rules add to them.
    options: fileSettings.freezes ? deepFreeze(options) : options,
    report: entry.reporter.report,
  };
  configured.set(id, entry);
  return entry;
}

// ------------- listeners -------------

// In the order of the event kinds in `code_path/estree.rs`.
const codePathEventNames = [
  "onCodePathStart",
  "onCodePathEnd",
  "onCodePathSegmentStart",
  "onCodePathSegmentEnd",
  "onUnreachableCodePathSegmentStart",
  "onUnreachableCodePathSegmentEnd",
  "onCodePathSegmentLoop",
];

// By the key of a listener: `{ kind, number, error }`, what `LISTEN` in `wire.rs` knows it by. A selector also has its `text`.
const listenedKeys = new Map();
// The selectors that the other side has not been asked about yet.
let newSelectors = [];

function describeKey(key) {
  let known = listenedKeys.get(key);
  if (known !== undefined) return known;
  const isExit = key.endsWith(":exit");
  const name = isExit ? key.slice(0, -5) : key;
  const type = native.typeId(name);
  const event = codePathEventNames.indexOf(key);
  if (type !== undefined) known = { kind: isExit ? 1 : 0, number: type, error: null };
  else if (event !== -1) known = { kind: 3, number: event, error: null };
  else newSelectors.push((known = { kind: 2, number: -1, error: null, text: key }));
  listenedKeys.set(key, known);
  return known;
}

function describeNewSelectors() {
  if (newSelectors.length === 0) return;
  askForJson(SELECTORS, JSON.stringify(newSelectors.map(it => it.text))).forEach((it, i) => {
    if (typeof it === "string") newSelectors[i].error = it;
    else newSelectors[i].number = it;
  });
  newSelectors = [];
}

// The listeners of the file by their key, `{ entry, listener }` each, and the same by the order in which the keys came.
let groupByKey = new Map();
let groups = [];

// The rule whose code is running, for the message of what it throws.
let currentRule = null;
let currentNode = null;
// `currentRule.rule.create()` is being called.
let isCreating = false;

function addListeners(entry, listeners) {
  for (const key of Object.keys(listeners)) {
    const listener = listeners[key];
    if (typeof listener !== "function") continue;
    let group = groupByKey.get(key);
    if (group === undefined) {
      groupByKey.set(key, (group = []));
      groups.push(group);
    }
    group.push({ entry, listener });
  }
}

// What `native.listen` is told.
let listenWords = new Uint32Array(64);
// 0: the tree of typescript-estree, which oxlint's is like in every file, 1: that of espree.
let fileDialect = 0;

function dialect() {
  return fileDialect;
}

// Tells the other side that `keys` are listened for. Returns the calls: see `calls.rs`. The nodes come along if there are calls and
// they are not there yet, or if `wantsTree`.
function listen(keys, wantsTree) {
  describeNewSelectors();
  for (const { error } of keys) if (error !== null) throw new SyntaxError(error);
  const length = 1 + 2 * keys.length;
  if (listenWords.length < length) listenWords = new Uint32Array(2 * length);
  // See `LACKS_TREE`, `WANTS_TREE` and `WANTS_ALL_EVENTS` in `wire.rs`.
  listenWords[0] = (nodes.length === 0 ? 1 : 0) | (wantsTree ? 2 : 0) | (fileSettings.isLegacy === true ? 4 : 0);
  for (let i = 0; i < keys.length; i++) {
    listenWords[1 + 2 * i] = keys[i].kind;
    listenWords[2 + 2 * i] = keys[i].number;
  }
  // By index: to take an array apart with `[a, b] =` goes through `Array.prototype`, which a plugin can have changed.
  const answer = native.listen(listenWords, length);
  if (answer[1] !== undefined) nodes = answer[1];
  return answer[0];
}

// The `Program`
function program() {
  if (nodes.length === 0) listen([], true);
  return nodes[0];
}

// Calls the listeners, in ESLint's order.
function traverse() {
  const calls = listen(Array.from(groupByKey.keys(), describeKey), false);
  let emitAt = null;
  for (let at = 0; at < calls.length; at += 2) {
    const what = calls[at];
    const group = groups[calls[at + 1]];
    if (what >= 0x80000000) {
      emitAt ??= openCodePaths();
      emitAt(4 * (what - 0x80000000), group ?? []);
      continue;
    }
    const node = (currentNode = nodes[what]);
    for (let i = 0; i < group.length; i++) {
      const { entry, listener } = group[i];
      currentRule = entry;
      listener(node);
    }
  }
}

// ------------- code paths -------------

// `codePath.origin`, in the order of `Origin` in `code_path/estree.rs`.
const codePathOrigins = ["program", "function", "class-field-initializer", "class-static-block"];
// `native.codePaths` builds the objects. Only ESLint's getters and methods live here.
class CodePath {
  get initialSegment() {
    return this.internal.initialSegment;
  }

  get finalSegments() {
    return this.internal.finalSegments;
  }

  get returnedSegments() {
    return this.internal.returnedForkContext;
  }

  get thrownSegments() {
    return this.internal.thrownForkContext;
  }

  traverseSegments(optionsOrCallback, callback) {
    const hasOptions = typeof optionsOrCallback !== "function";
    const options = (hasOptions && optionsOrCallback) || {};
    const resolvedCallback = hasOptions ? callback : optionsOrCallback;
    const startSegment = options.first || this.internal.initialSegment;
    const lastSegment = options.last;
    const visited = new Set();
    const skipped = new Set();
    const stack = [[startSegment, 0]];
    let segment = null;
    let broken = false;
    const controller = {
      skip() {
        skipped.add(segment);
      },
      break() {
        broken = true;
      },
    };
    const isVisited = prevSegment => visited.has(prevSegment) || segment.isLoopedPrevSegment(prevSegment);
    const isSkipped = prevSegment => skipped.has(prevSegment) || segment.isLoopedPrevSegment(prevSegment);
    while (stack.length > 0) {
      const record = stack.at(-1);
      segment = record[0];
      const index = record[1];
      if (index === 0) {
        const hasPrev = segment.prevSegments.length > 0;
        if (visited.has(segment) || (segment !== startSegment && hasPrev && !segment.prevSegments.every(isVisited))) {
          stack.pop();
          continue;
        }
        visited.add(segment);
        if (skipped.size > 0 && hasPrev && segment.prevSegments.every(isSkipped)) skipped.add(segment);
        else {
          resolvedCallback.call(this, segment, controller);
          if (segment === lastSegment) controller.skip();
          if (broken) break;
        }
      }
      const end = segment.nextSegments.length - 1;
      if (index < end) {
        record[1] += 1;
        stack.push([segment.nextSegments[index], 0]);
      } else if (index === end) {
        record[0] = segment.nextSegments[index];
        record[1] = 0;
      } else stack.pop();
    }
  }
}

class CodePathSegment {
  isLoopedPrevSegment(segment) {
    return this.internal.loopedPrevSegments.includes(segment);
  }
}

const legacyPrototype = Object.defineProperties(
  {},
  {
    ...Object.getOwnPropertyDescriptors(CodePath.prototype),
    currentSegments: {
      get() {
        return this.internal.currentSegments;
      },
      configurable: true,
    },
  },
);
// Templates for `native.codePaths`.
const codePathKeys = ["id", "origin", "upper", "childCodePaths", "internal"];
const codePathShapes = [
  native.shape(CodePath.prototype, codePathKeys, "", 1),
  native.shape(Object.prototype, ["initialSegment", "finalSegments", "returnedForkContext", "thrownForkContext"], null),
  native.shape(
    CodePathSegment.prototype,
    ["id", "nextSegments", "prevSegments", "allNextSegments", "allPrevSegments", "reachable", "internal"],
    "",
    1,
  ),
  native.shape(Object.prototype, ["used", "loopedPrevSegments"], true),
];
// The same for a configuration for ESLint 8, where a code path also has `currentSegments`.
const legacyCodePathShapes = [native.shape(legacyPrototype, codePathKeys, "", 1), ...codePathShapes.slice(1)];

// Makes the code paths of the file. The analysis is finished before the first listener runs, as in ESLint, so a rule sees the
// complete graph from the first event on. Returns `emitAt(at, calls)`, which calls the listeners `calls` for the event that starts at
// `at` in the events, which have four words each: see `code_path/estree.rs`. The events have to come in order.
function openCodePaths() {
  const isLegacy = fileSettings.isLegacy === true;
  const shapesOfPaths = isLegacy ? legacyCodePathShapes : codePathShapes;
  const { 0: paths, 1: segments, 2: events } = native.codePaths(shapesOfPaths, codePathOrigins);
  if (isLegacy) for (const path of paths) path.internal.currentSegments = [];
  // `internal` of the code paths that have started and not ended, to keep `currentSegments` up to date.
  const open = [];
  // The segments that have ended since `currentSegments` was last replaced.
  const ended = [];
  // The start events before this index are in `currentSegments` already.
  let included = 0;
  // That of the event that is being emitted.
  let step = 0;
  const isStart = kind => kind === 2 || kind === 4;
  const isEnd = kind => kind === 3 || kind === 5;
  const kindAt = index => (index < events.length && events[index] === step ? events[index + 1] & 7 : -1);
  // ESLint 8 replaces `currentSegments` once per step, after the last end event and before the first start event. A new
  // segment takes the place of the one that ended. `from`: the index of the first start event, if there is one.
  const replaceCurrentSegments = from => {
    const current = [...open.at(-1).currentSegments];
    const places = ended.map(it => current.indexOf(it));
    let count = 0;
    for (; isStart(kindAt(from + 4 * count)); count++) {
      const segment = segments[events[from + 4 * count + 2]];
      if (count < places.length) current[places[count]] = segment;
      else current.push(segment);
    }
    const removed = places.slice(count);
    open.at(-1).currentSegments = current.filter((_, place) => !removed.includes(place));
    ended.length = 0;
    included = from + 4 * count;
  };
  const emitAt = (at, calls) => {
    step = events[at];
    const kind = events[at + 1] & 7;
    const first = (kind < 2 ? paths : segments)[events[at + 2]];
    if (isLegacy) {
      if (kind === 0) open.push(first.internal);
      else if (isStart(kind) && at >= included) replaceCurrentSegments(at);
    }
    const node = nodes[events[at + 1] >>> 3];
    for (const { entry, listener } of calls) {
      currentRule = entry;
      if (kind === 6) listener(first, segments[events[at + 3]], node);
      else listener(first, node);
    }
    if (isLegacy) {
      if (kind === 1) open.pop();
      else if (isEnd(kind)) {
        ended.push(first);
        if (!isEnd(kindAt(at + 4))) replaceCurrentSegments(at + 4);
      }
    }
  };
  return emitAt;
}

// ------------- a file -------------

function reset() {
  native.endFile();
  text = "";
  sourceCode = new SourceCode();
  nodes = [];
  groupByKey = new Map();
  groups = [];
  currentRule = currentNode = null;
  isCreating = false;
  // Some are left if another rule's `create` or `before` threw. They aren't for the next file.
  afterHooks = [];
  resetScopes();
}

// Returns the positions of the plugins that are missing, if any are, or `NEEDS_SETTINGS`.
function lint() {
  const { 0: flags, 1: plugins, 2: settingsId, 3: count, 4: pathLength, 5: physicalLength } = messageWords(6);
  const words = messageWords(6 + plugins + count);
  // Only the plugins that have a rule which runs on the file, and which no module exports.
  const missing = Array.from(words.subarray(6, 6 + plugins)).filter(position => !loadedPlugins.has(position));
  if (missing.length > 0) return missing;
  const ids = words.subarray(6 + plugins);
  fileSettings = allSettings.get(settingsId);
  if (fileSettings === undefined) {
    if ((flags & 8) !== 0) return NEEDS_SETTINGS;
    allSettings.set(settingsId, (fileSettings = askForJson(SETTINGS)));
    if (fileSettings.freezes) deepFreeze(fileSettings);
    else addParser(fileSettings);
  }
  if (fileSettings.freezes) fileSettings = settingsFor(fileSettings, (flags >> 5) & 7);
  const entries = Array.from(ids, (id, position) => configured.get(id) ?? configure(id, position));
  if (toImport.length > 0) return NEEDS_MODULES;
  const unloaded = new Set(entries.filter(it => typeof it === "number"));
  if (unloaded.size > 0) return [...unloaded];
  const pathStart = 24 + 4 * (plugins + count);
  fileDialect = (flags >> 2) & 1;
  filename = nativePath(messageText(pathStart, pathStart + pathLength), nodePath);
  physicalFilename =
    physicalLength === pathLength ? filename : nativePath(messageText(pathStart, pathStart + physicalLength), nodePath);
  text = messageText(pathStart + pathLength);
  native.beginFile(text, flags);
  const fileContext = fileSettings.freezes ? oxlintFileContext : new FileContext();
  for (let position = 0; position < count; position++) {
    const entry = entries[position];
    entry.position = entry.reporter.position = position;
    currentRule = entry;
    // A new context for each file, and a new `sourceCode`, as in ESLint: plugins keep what they know about a file in a `WeakMap`
    // under one of them.
    // ESLint only knows `create`. A rule without it, which ESLint refuses, runs as in oxlint.
    const { create, createOnce } = entry.rule;
    isCreating = true;
    const listeners =
      typeof createOnce === "function" && (fileSettings.freezes || typeof create !== "function")
        ? listenersOfOnce(entry)
        : entry.rule.create(fileContext.extend(entry.own));
    isCreating = false;
    if (listeners === undefined || listeners === null) {
      throw new Error(`The create() function for rule '${entry.ruleId}' did not return an object.`);
    }
    addListeners(entry, listeners);
  }
  try {
    if (groups.length > 0) traverse();
  } finally {
    runAfterHooks();
  }
  return null;
}

// The rules whose `after` has to be called when the file is done.
let afterHooks = [];

// oxlint's alternative to `create`: the listeners are made once, `before` is called with each file and can refuse it, `after`
// when the file is done.
function listenersOfOnce(entry) {
  if (entry.once === null) {
    const { before, after, ...listeners } = entry.rule.createOnce(oxlintFileContext.extend(entry.own));
    entry.once = { before, after, listeners };
  }
  const { before, after, listeners } = entry.once;
  if (typeof before === "function" && before() === false) return {};
  if (typeof after === "function") afterHooks.push(entry);
  return listeners;
}

// All of them, whatever one of them throws.
function runAfterHooks() {
  const hooks = afterHooks;
  afterHooks = [];
  let thrown = null;
  for (const entry of hooks) {
    try {
      currentRule = entry;
      entry.once.after();
    } catch (error) {
      thrown ??= { error };
    }
  }
  if (thrown !== null) throw thrown.error;
}

let hasStarted = false;

// ------------- what is loaded -------------

let measuresLoading = false;
// The time that it took to load plugins and processors and that the other side has not been told.
let loadingTime = 0;
// The files that the other side has been told of.
const countedModules = new Set();

function reportLoading() {
  const { statSync } = require("node:fs");
  let bytes = 0;
  const before = countedModules.size;
  for (const file of Object.keys(require.cache)) {
    if (countedModules.has(file) || !nodePath.isAbsolute(file)) continue;
    countedModules.add(file);
    bytes += statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  }
  const modules = countedModules.size - before;
  if (modules > 0 || loadingTime > 0) native.askText(LOADED, JSON.stringify([modules, bytes, loadingTime]));
  loadingTime = 0;
}

function start() {
  const { cwd: directory, measures } = askForJson(START);
  cwd = directory;
  measuresLoading = measures;
  defineNodes();
  hasStarted = true;
}

// With where in the plugin it was thrown, and without what is not the user's.
function describeLoadError(error) {
  const lines = messageOf(error, it => it?.stack ?? it).split("\n");
  const stack = lines.indexOf("Require stack:");
  if (stack !== -1) lines.length = stack;
  // What it is made of says more than that there are several.
  try {
    if (error instanceof AggregateError) for (const it of error.errors) lines.push(`  ${messageOf(it, String)}`);
  } catch {}
  return lines.filter(it => !/^\s+at .*(?:\bbun-lint-plugins\.js|\(native):\d+/.test(it)).join("\n");
}

// What the other side calls, with what the message is. Returns the result, or a promise of it.
function handle(kind) {
  if (!hasStarted) start();
  const returned = respond(kind);
  if (!measuresLoading) return returned;
  if (typeof returned !== "string") return returned.finally(reportLoading);
  reportLoading();
  return returned;
}

function respond(kind) {
  if (kind >= FORMAT_WITH_PRETTIER) return handleForPrettier();
  if (kind >= LINT_WITH_ESLINT) return handleForEslint(kind);
  if (kind >= PREPROCESS) return handleForProcessor(kind);
  if (kind === LOAD_SETTINGS) {
    return loadSettings(askForJson(MESSAGE)).catch(error => FAILED + describeLoadError(error));
  }
  if (kind === LOAD) {
    return loadPlugin(askForJson(MESSAGE)).then(
      described => DONE + stringify(described),
      error => FAILED + describeLoadError(error),
    );
  }
  try {
    const missing = lint();
    if (missing === NEEDS_MODULES) return importAll(toImport.splice(0)).then(() => respond(kind));
    if (missing === NEEDS_SETTINGS) return `${NEEDS_SETTINGS}[]`;
    if (missing !== null) return NEEDS_PLUGINS + JSON.stringify(missing);
    const used = usedVariables();
    native.sendReports();
    return used.length === 0 ? DONE : DONE + JSON.stringify(used);
  } catch (error) {
    // The node is the plugin's to change.
    let line = null;
    try {
      line = Number(currentNode.loc.start.line);
    } catch {}
    if (fileSettings?.freezes)
      return FAILED + JSON.stringify([currentRule?.position ?? null, saidByOxlint(error), line]);
    if (isCreating) return FAILED + JSON.stringify(thrownInCreate(error));
    return FAILED + JSON.stringify([currentRule?.position ?? null, messageOf(error), line]);
  } finally {
    reset();
  }
}

return handle;
