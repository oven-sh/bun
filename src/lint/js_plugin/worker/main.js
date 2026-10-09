// ───────────── the program ─────────────
//
// It is the body of a function of `require`, `load`, which is `import()`, and of what it asks the other side with:
// - `request(kind, details, buffer)` asks for something, writes the answer into `buffer` and returns its length. If that
//   is more than fits, nothing is written.
// - `again(buffer)` then writes it into a larger one.
// - `decode(buffer, start, end)` is the text that these bytes of `buffer` are in UTF-8.
//
// It returns `handle`, which the other side calls. See `wire.rs` for what is said. All of it is synchronous but for loading
// a plugin.

const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const nodePath = require("node:path");
const { statSync } = require("node:fs");

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
const AST = 5;
const MATCHES = 6;
const TOKENS = 7;
const COMMENTS = 8;
const SCOPES = 9;
const LOADED = 10;

// By what was asked for: the last answer, which the next one overwrites.
const buffers = [];

// Asks for something. The answer is in `buffers[kind]`. Returns its length.
function ask(kind, details = "") {
  const buffer = (buffers[kind] ??= new ArrayBuffer(1 << 16));
  const length = request(kind, details, buffer);
  if (length > buffer.byteLength) again((buffers[kind] = new ArrayBuffer(2 ** Math.ceil(Math.log2(length)))));
  return length;
}

// What `evaluate-eslint.js` has written for a `RegExp`.
const reviveRegExp = (_, value) => (Array.isArray(value?.$regexp) ? new RegExp(...value.$regexp) : value);

function askForJson(kind, details) {
  const length = ask(kind, details);
  const json = decode(buffers[kind], 0, length);
  return json.includes('"$regexp"') ? JSON.parse(json, reviveRegExp) : JSON.parse(json);
}

// ───────────── plugins ─────────────

let cwd = "";
// The rules of the plugins that are loaded: `{ plugin, name }`, by the number that the other side knows them by.
const rules = [];
// The positions of the plugins whose rules are in `rules`.
const loadedPlugins = new Set();
// By where they are, as JSON: `{ name, plugin }` of the plugins that were ever loaded.
const pluginsByLocation = new Map();

// oxlint's `normalizePluginName`.
function normalizePluginName(name) {
  const prefixes = ["eslint-plugin", "oxlint-plugin"];
  const slash = name.indexOf("/");
  if (slash === -1) {
    const prefix = prefixes.find(prefix => name.startsWith(`${prefix}-`));
    return prefix ? name.slice(prefix.length + 1) : name;
  }
  const scope = name.slice(0, slash);
  const rest = name.slice(slash + 1);
  for (const prefix of prefixes) {
    if (rest === prefix) return scope;
    if (rest.startsWith(`${prefix}-`)) return `${scope}/${rest.slice(prefix.length + 1)}`;
  }
  return name;
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

// What the configuration files that were needed to find a plugin export, by their paths.
const configurations = new Map();

// What is at `path` in what a module exports. Of an ES module that exports something as "module.exports", `require` returns only
// that, which is also what it exports as `default`.
function exportedAt(exported, path) {
  let found = exported;
  for (const name of path) {
    const inner = found[name];
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
    return exportedAt(found, location.export);
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

async function findPlugin([directory, specifier, alias]) {
  const isLocated = typeof directory === "object";
  const isPath = isLocated || /^\.{0,2}[\\/]/u.test(specifier) || nodePath.isAbsolute(specifier);
  let plugin;
  if (isLocated) plugin = await locatedPlugin(directory, alias);
  else {
    const file = isPath
      ? nodePath.resolve(directory, specifier)
      : createRequire(nodePath.join(directory, "noop.js")).resolve(specifier);
    const module = await load(pathToFileURL(file).href);
    plugin = module.default ?? module;
  }
  if (plugin === null || typeof plugin !== "object") throw new TypeError("A plugin must export an object.");
  let name = alias;
  if (name === null && plugin.meta?.name != null) {
    if (typeof plugin.meta.name !== "string") throw new TypeError("`plugin.meta.name` must be a string if defined");
    name = normalizePluginName(plugin.meta.name);
  }
  if (name === null && !isPath) name = normalizePluginName(specifier);
  if (name === null) {
    throw new Error(
      "Plugin must either define `meta.name`, be loaded from an NPM package with a `name` field in `package.json`, or be given an alias in config",
    );
  }
  return { name, plugin };
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
    whyNoRule = ` ${location.module}: ${error?.message ?? error}`;
    return undefined;
  } finally {
    loadingTime += performance.now() - started;
  }
}

// `position`, `firstRule`: `null` as long as the other side does not know the plugin.
async function loadPlugin([location, position, firstRule]) {
  const key = JSON.stringify(location);
  let found = pluginsByLocation.get(key);
  if (found === undefined) {
    const started = performance.now();
    pluginsByLocation.set(key, (found = await findPlugin(location)));
    loadingTime += performance.now() - started;
  }
  const { name, plugin } = found;
  const described = [];
  const exported = position === null ? exportedObjects() : null;
  // Sorted: a plugin that imports its rules all at once has them in another order each time.
  const names = Object.keys(plugin.rules ?? {}).sort();
  names.forEach((ruleName, i) => {
    // A plugin can load a rule when it is asked for it.
    if (position !== null) rules[firstRule + i] = { plugin, name: ruleName };
    else {
      const meta = plugin.rules[ruleName].meta;
      described.push({
        name: ruleName,
        at: exported.get(plugin.rules[ruleName]),
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
  return { name, rules: described };
}

// ───────────── ESLint's `context` ─────────────

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

// What all rules see of a file. The contexts of the rules inherit from it.
const fileContext = Object.freeze({
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
    return fileSettings.languageOptions;
  },
  get parserOptions() {
    return fileSettings.languageOptions.parserOptions;
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
  extend(extension) {
    return Object.freeze(Object.assign(Object.create(this), extension));
  },
});

// The rule with its options that has `id`, and is at `position` among those that run on the file. Or the position of its plugin,
// which has to be loaded first. Or `null`: its module is among `toImport`.
function configure(id, position) {
  const [index, options, ruleId, location, pluginPosition] = askForJson(CONFIGURED, String(position));
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
  const entry = { rule, ruleId, own: null, position: 0, once: null };
  const meta = rule.meta;
  entry.own = {
    id: ruleId,
    // ESLint leaves them as they are, and rules add to them.
    options: fileSettings.freezes ? deepFreeze(options) : options,
    report(...args) {
      report(entry.position, meta, args);
    },
  };
  configured.set(id, entry);
  return entry;
}

// ───────────── listeners ─────────────

// All selectors that are not just the name of a type, by their text. The other side knows them by `number`.
const selectors = new Map();
// Those that the other side has not been asked about yet.
let newSelectors = [];

function describeNewSelectors() {
  if (newSelectors.length === 0) return;
  askForJson(SELECTORS, JSON.stringify(newSelectors.map(it => it.text))).forEach((it, i) => {
    const selector = newSelectors[i];
    if (typeof it === "string") selector.error = it;
    else [selector.number, selector.attributes, selector.identifiers] = it;
  });
  newSelectors = [];
}

const codePathEvents = new Set([
  "onCodePathStart",
  "onCodePathEnd",
  "onCodePathSegmentStart",
  "onCodePathSegmentEnd",
  "onCodePathSegmentLoop",
  "onUnreachableCodePathSegmentStart",
  "onUnreachableCodePathSegmentEnd",
]);

// The listeners of the file. By the number of a type: those for entering and for leaving a node of it.
let enterByType = [];
let exitByType = [];
// By their text: `{ selector, calls }`, for the selectors that are listened for.
let bySelector = new Map();
// By the name of an event of the code path analysis. `null`: nothing listens for any.
let codePathCalls = null;
let hasListeners = false;
let hasExitListeners = false;

// The rule whose code is running, for the message of what it throws.
let currentRule = null;
let currentNode = null;

function addListeners(entry, listeners) {
  for (const key of Object.keys(listeners)) {
    const listener = listeners[key];
    if (typeof listener !== "function") continue;
    const call = { entry, listener };
    hasListeners = true;
    const isExit = key.endsWith(":exit");
    const type = typeIds.get(isExit ? key.slice(0, -5) : key);
    if (type !== undefined) {
      const byType = isExit ? exitByType : enterByType;
      (byType[type] ??= []).push(call);
      hasExitListeners ||= isExit;
      continue;
    }
    if (codePathEvents.has(key)) {
      (codePathCalls ??= new Map()).set(key, [...(codePathCalls.get(key) ?? []), call]);
      continue;
    }
    let selector = selectors.get(key);
    if (selector === undefined) {
      selector = { text: key, number: -1, isExit, attributes: 0, identifiers: 0, error: null };
      selectors.set(key, selector);
      newSelectors.push(selector);
    }
    hasExitListeners ||= isExit;
    let listened = bySelector.get(key);
    if (listened === undefined) bySelector.set(key, (listened = { selector, calls: [] }));
    listened.calls.push(call);
  }
}

// ───────────── the parts of a file that are asked for ─────────────

// The numbers of the selectors to match.
function selectorRequest() {
  describeNewSelectors();
  return JSON.stringify(Array.from(bySelector.values(), it => it.selector.number));
}

// What matches the selectors of `bySelector`, in its order. `null`: not asked for yet.
let matches = null;

// The numbers of the types that are listened to. `null`: every node matters.
function listenedTypes() {
  if (codePathCalls !== null) return null;
  return [...new Set([...Object.keys(enterByType), ...Object.keys(exitByType)])].map(Number);
}

// Nothing that is listened to is in the file, so its tree was not sent. Who asks for it now gets it.
let isWithoutListened = false;

// The `Program`. `null`, to `traverse`: nothing that is listened to is in the file.
function program() {
  if (tree === null) {
    // Once the listeners are known, what matches comes with the tree.
    const count = isTraversing ? bySelector.size : 0;
    const types = isTraversing && !isWithoutListened ? listenedTypes() : null;
    ask(AST, `[${isTraversing ? selectorRequest() : "[]"},${JSON.stringify(types)}]`);
    if (new Uint32Array(buffers[AST], 0, 1)[0] === 0) {
      isWithoutListened = true;
      return null;
    }
    tree = readTree(buffers[AST], count);
    if (isTraversing) matches = tree.matches;
    makeNodes();
    const root = nodes[0];
    Object.defineProperty(root, "comments", { get: comments, enumerable: true, configurable: true });
    Object.defineProperty(root, "tokens", { get: tokens, enumerable: true, configurable: true });
  }
  return nodes[0];
}

// 0: the tree of typescript-estree, 1: that of espree.
let fileDialect = 0;

function dialect() {
  return fileDialect;
}

let descendants = null;

// By the number of a node: the number of the last node that is in it, or its own.
function lastDescendants() {
  if (descendants === null) {
    const { count, parents } = tree;
    descendants = new Uint32Array(count);
    for (let id = count - 1; id > 0; id--) {
      if (descendants[id] === 0) descendants[id] = id;
      const parent = parents[id];
      if (descendants[parent] < descendants[id]) descendants[parent] = descendants[id];
    }
  }
  return descendants;
}

// ───────────── the traversal ─────────────

let isTraversing = false;

// Tells the listeners for the event `name` of the code path analysis.
function emitCodePathEvent(name, args) {
  const calls = codePathCalls.get(name);
  if (calls === undefined) return;
  for (const call of calls) {
    currentRule = call.entry;
    call.listener(...args);
  }
}

function callAll(calls, node) {
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    currentRule = call.entry;
    call.listener(node);
  }
}

// ESLint's order of the selectors that match one node: the less specific first.
function compareSelectors(a, b) {
  return a.attributes - b.attributes || a.identifiers - b.identifiers || (a.text <= b.text ? -1 : 1);
}

// By the number of a node: the calls for the selectors that match it, with those for its type, in order.
function callsByNode(isExit, byType) {
  const listened = [...bySelector.values()];
  const byNode = new Map();
  listened.forEach(({ selector, calls }, i) => {
    if (selector.isExit !== isExit) return;
    for (const id of matches[i]) {
      let list = byNode.get(id);
      if (list === undefined) {
        byNode.set(id, (list = []));
        const type = tree.types[id];
        const name = typeNames[type] + (isExit ? ":exit" : "");
        if (byType[type]) list.push({ selector: { attributes: 0, identifiers: 1, text: name }, calls: byType[type] });
      }
      list.push({ selector, calls });
    }
  });
  for (const [id, list] of byNode) {
    list.sort((a, b) => compareSelectors(a.selector, b.selector));
    byNode.set(
      id,
      list.flatMap(it => it.calls),
    );
  }
  return byNode;
}

function traverse() {
  isTraversing = true;
  const root = program();
  if (root !== null && matches === null && bySelector.size > 0) {
    const length = ask(MATCHES, selectorRequest());
    matches = readMatches(new Uint32Array(buffers[MATCHES], 0, length >> 2), bySelector.size);
  }
  for (const { selector } of bySelector.values()) {
    if (selector.error !== null) throw new SyntaxError(selector.error);
  }
  if (root === null) return;
  const { count, types, twice } = tree;
  const enterByNode = bySelector.size > 0 ? callsByNode(false, enterByType) : null;
  const exitByNode = bySelector.size > 0 ? callsByNode(true, exitByType) : null;
  const enter = id => {
    const calls = enterByNode?.get(id) ?? enterByType[types[id]];
    if (calls !== undefined) callAll(calls, (currentNode = nodes[id]));
  };
  const exitCalls = id => exitByNode?.get(id) ?? exitByType[types[id]];
  const leave = id => {
    const calls = exitCalls(id);
    if (calls !== undefined) callAll(calls, (currentNode = nodes[id]));
  };
  const visitedTwice = twice.length > 0 ? new Set(twice) : null;
  if (codePathCalls === null && !hasExitListeners && visitedTwice === null) {
    for (let id = 0; id < count; id++) enter(id);
    return;
  }
  const last = lastDescendants();
  // Calls `enterNode` and `leaveNode` with the number of each node that `isLeft` says has to be left, and `enterNode` with
  // that of every other.
  const walk = (enterNode, leaveNode, isLeft) => {
    const open = [];
    for (let id = 0; id < count; id++) {
      while (open.length > 0 && last[open.at(-1)] < id) leaveNode(open.pop());
      enterNode(id);
      if (visitedTwice?.has(id)) {
        leaveNode(id);
        enterNode(id);
      }
      if (isLeft(id)) open.push(id);
    }
    while (open.length > 0) leaveNode(open.pop());
  };
  if (codePathCalls === null) return walk(enter, leave, id => exitCalls(id) !== undefined);
  // As in ESLint the whole file is analyzed before the first listener is called: a rule sees the finished graph. A step is
  // the number of a node to enter, the complement of that of one to leave, or an event and its arguments.
  const steps = [];
  let current = 0;
  const analyzer = new CodePathAnalyzer({
    enterNode: () => steps.push(current),
    leaveNode: () => steps.push(~current),
    emit: (name, args) => steps.push([name, args]),
  });
  walk(
    id => analyzer.enterNode(nodes[(current = id)]),
    id => analyzer.leaveNode(nodes[(current = id)]),
    () => true,
  );
  for (const step of steps) {
    if (typeof step !== "number") emitCodePathEvent(step[0], step[1]);
    else if (step >= 0) enter(step);
    else leave(~step);
  }
}

// ───────────── a file ─────────────

function reset() {
  text = "";
  lineStarts = lines = inlineConfigNodes = disableDirectives = parserServices = null;
  sourceCode = new SourceCode();
  tree = null;
  nodes = [];
  descendants = matches = null;
  enterByType = [];
  exitByType = [];
  bySelector = new Map();
  codePathCalls = null;
  hasListeners = hasExitListeners = isTraversing = isWithoutListened = false;
  currentRule = currentNode = null;
  reports = [];
  resetTokens();
  resetScopes();
}

// Returns the positions of the plugins that are missing, if any are, or `NEEDS_SETTINGS`.
function lint() {
  const length = ask(MESSAGE);
  const buffer = buffers[MESSAGE];
  const [flags, plugins, settingsId, count, pathLength, physicalLength] = new Uint32Array(buffer, 0, 6);
  // Only the plugins that have a rule which runs on the file, and which no module exports.
  const missing = Array.from(new Uint32Array(buffer, 24, plugins)).filter(position => !loadedPlugins.has(position));
  if (missing.length > 0) return missing;
  const ids = new Uint32Array(buffer, 24 + 4 * plugins, count);
  fileSettings = allSettings.get(settingsId);
  if (fileSettings === undefined) {
    if ((flags & 8) !== 0) return NEEDS_SETTINGS;
    allSettings.set(settingsId, (fileSettings = askForJson(SETTINGS)));
    if (fileSettings.freezes) deepFreeze(fileSettings);
    else addParser(fileSettings);
  }
  const entries = Array.from(ids, (id, position) => configured.get(id) ?? configure(id, position));
  if (toImport.length > 0) return NEEDS_MODULES;
  const unloaded = new Set(entries.filter(it => typeof it === "number"));
  if (unloaded.size > 0) return [...unloaded];
  const pathStart = 24 + 4 * (plugins + count);
  wantsFixes = (flags & 1) !== 0;
  hasBOM = (flags & 2) !== 0;
  fileDialect = (flags >> 2) & 1;
  filename = nativePath(decode(buffer, pathStart, pathStart + pathLength), nodePath);
  physicalFilename =
    physicalLength === pathLength
      ? filename
      : nativePath(decode(buffer, pathStart, pathStart + physicalLength), nodePath);
  text = decode(buffer, pathStart + pathLength, length);
  for (let position = 0; position < count; position++) {
    const entry = entries[position];
    entry.position = position;
    currentRule = entry;
    // A new context for each file, and a new `sourceCode`, as in ESLint: plugins keep what they know about a file in a `WeakMap`
    // under one of them.
    const listeners =
      typeof entry.rule.createOnce === "function"
        ? listenersOfOnce(entry)
        : entry.rule.create(fileContext.extend(entry.own));
    if (listeners === undefined || listeners === null) {
      throw new Error(`The create() function for rule '${entry.ruleId}' did not return an object.`);
    }
    addListeners(entry, listeners);
  }
  try {
    if (hasListeners) traverse();
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
    const { before, after, ...listeners } = entry.rule.createOnce(fileContext.extend(entry.own));
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

// ───────────── what is loaded ─────────────

let measuresLoading = false;
// The time that it took to load plugins and processors and that the other side has not been told.
let loadingTime = 0;
// The files that the other side has been told of.
const countedModules = new Set();

function reportLoading() {
  let bytes = 0;
  const before = countedModules.size;
  for (const file of Object.keys(require.cache)) {
    if (countedModules.has(file) || !nodePath.isAbsolute(file)) continue;
    countedModules.add(file);
    bytes += statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  }
  const modules = countedModules.size - before;
  if (modules > 0 || loadingTime > 0) ask(LOADED, JSON.stringify([modules, bytes, loadingTime]));
  loadingTime = 0;
}

function start() {
  const { cwd: directory, measures, types, strings } = askForJson(START);
  cwd = directory;
  measuresLoading = measures;
  defineTypes(types, strings);
  hasStarted = true;
}

// With where in the plugin it was thrown, and without what is not the user's.
function describeLoadError(error) {
  const lines = String(error?.stack ?? error).split("\n");
  const stack = lines.indexOf("Require stack:");
  if (stack !== -1) lines.length = stack;
  return lines.filter(it => !/^\s+at .*\bbun-lint-plugins\.js:\d+/.test(it)).join("\n");
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
    return reports.length === 0 && used.length === 0 ? DONE : DONE + JSON.stringify([reports, used]);
  } catch (error) {
    const line = currentNode === null ? null : currentNode.loc.start.line;
    return FAILED + JSON.stringify([currentRule?.position ?? null, String(error?.message ?? error), line]);
  } finally {
    reset();
  }
}

return handle;
