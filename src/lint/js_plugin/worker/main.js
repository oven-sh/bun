// ───────────── the worker ─────────────
//
// Reads messages from standard input and answers on standard output: see `wire.rs`. All of it is
// synchronous but for loading a plugin.

const { writeSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const nodePath = require("node:path");

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

// What a plugin prints must not get between the messages.
console.log = console.info = console.debug = console.error;
process.stdout.write = process.stderr.write.bind(process.stderr);

const START = 2;
const LOAD = 3;
const SETTINGS = 4;
const CONFIGURE = 5;
const LINT = 6;
const AST = 7;
const MATCHES = 8;
const SELECTORS = 9;
const TOKENS = 10;
const COMMENTS = 11;
const SCOPES = 12;

const LOADED = 1;
const FAILED = 2;
const DONE = 3;
const NEEDS_AST = 4;
const NEEDS_MATCHES = 5;
const NEEDS_TOKENS = 6;
const NEEDS_COMMENTS = 7;
const NEEDS_SCOPES = 8;

const header = new Uint32Array(2);
const headerBytes = new Uint8Array(header.buffer);

// A buffer for each kind of message, which the next message of the kind overwrites.
const buffers = [];

// Waits for a message, and returns what it is. Its content is in `buffers[kind]`, from 0 to `header[0]`.
function next() {
  receive(headerBytes, 8);
  const [length, kind] = header;
  let buffer = buffers[kind];
  if (buffer === undefined || buffer.byteLength < length) {
    buffer = buffers[kind] = new ArrayBuffer(Math.max(1 << 16, 2 ** Math.ceil(Math.log2(length + 8))));
  }
  receive(new Uint8Array(buffer), length);
  return kind;
}

function contentAsText(kind) {
  return decoder.decode(new Uint8Array(buffers[kind], 0, header[0]));
}

function send(kind, content) {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  const message = Buffer.allocUnsafe(8 + bytes.length);
  message.writeUInt32LE(bytes.length, 0);
  message.writeUInt32LE(kind, 4);
  message.set(bytes, 8);
  for (let at = 0; at < message.length; ) at += writeSync(1, message, at);
}

// Sends a request, and waits for the answer, which is of the kind `expected`.
function ask(kind, content, expected) {
  send(kind, content);
  for (;;) {
    const got = next();
    if (got === expected) return;
    if (got === SELECTORS) defineSelectors(JSON.parse(contentAsText(got)));
    else throw new Error(`Expected message ${expected}, got ${got}.`);
  }
}

// ───────────── plugins ─────────────

let cwd = "";
// The rules of all plugins: `{ rule, id }`, by the number that the other side knows them by.
const rules = [];

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
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

async function loadPlugin([directory, specifier, alias]) {
  const isPath = /^\.{0,2}[\\/]/u.test(specifier) || nodePath.isAbsolute(specifier);
  const file = isPath
    ? nodePath.resolve(directory, specifier)
    : createRequire(nodePath.join(directory, "noop.js")).resolve(specifier);
  const module = await load(pathToFileURL(file).href);
  const plugin = module.default ?? module;
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
  const described = [];
  for (const [ruleName, rule] of Object.entries(plugin.rules ?? {})) {
    // A function is a rule without `meta`, as for ESLint until version 8.
    const definition = typeof rule === "function" ? { create: rule } : rule;
    const meta = definition.meta;
    rules.push({ rule: definition, id: `${name}/${ruleName}` });
    described.push({
      name: ruleName,
      type: meta?.type,
      fixable: Boolean(meta?.fixable),
      hasSuggestions: meta?.hasSuggestions === true,
      schema: asJson(meta?.schema),
      defaultOptions: asJson(meta?.defaultOptions),
    });
  }
  return { name, rules: described };
}

// ───────────── ESLint's `context` ─────────────

let filename = "";
// `{ settings, languageOptions }` of the file.
let fileSettings = null;
const allSettings = new Map();
// By id: a rule with its options, `{ rule, meta, context, position }`.
const configured = new Map();

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// What all rules see of a file. The contexts of the rules inherit from it, and are the same objects
// for every file.
const fileContext = Object.freeze({
  get cwd() {
    return cwd;
  },
  get filename() {
    return filename;
  },
  get physicalFilename() {
    return filename;
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
  get parserPath() {
    return undefined;
  },
  get parserServices() {
    return parserServices;
  },
  getCwd() {
    return cwd;
  },
  getFilename() {
    return filename;
  },
  getPhysicalFilename() {
    return filename;
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
  extend(extension) {
    return Object.freeze(Object.assign(Object.create(this), extension));
  },
});

function configure([id, index, options]) {
  const { rule, id: ruleId } = rules[index];
  const entry = { rule, ruleId, context: null, position: 0 };
  const meta = rule.meta;
  entry.context = fileContext.extend({
    id: ruleId,
    options: deepFreeze(options),
    report(...args) {
      report(entry.position, meta, args);
    },
  });
  configured.set(id, entry);
}

// ───────────── listeners ─────────────

// All selectors that are not just the name of a type, by their text. The other side knows them by `index`.
const selectors = new Map();
// Those that the other side has not seen yet.
let newSelectors = [];
// In the order of `index`.
const selectorList = [];

// `[attributeCount, identifierCount]` for each of `newSelectors`, or why it cannot be used.
function defineSelectors(described) {
  described.forEach((it, i) => {
    const selector = newSelectors[i];
    if (typeof it === "string") selector.error = it;
    else [selector.attributes, selector.identifiers] = it;
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
// By `index`: `{ selector, listeners }`, for the selectors that are listened for.
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
      selector = { text: key, index: selectorList.length, isExit, attributes: 0, identifiers: 0, error: null };
      selectors.set(key, selector);
      selectorList.push(selector);
      newSelectors.push(selector);
    }
    hasExitListeners ||= isExit;
    let listened = bySelector.get(selector.index);
    if (listened === undefined) bySelector.set(selector.index, (listened = { selector, calls: [] }));
    listened.calls.push(call);
  }
}

// ───────────── the parts of a file that are asked for ─────────────

// `[new selectors, the selectors to match]`
function selectorRequest() {
  return JSON.stringify([newSelectors.map(it => it.text), [...bySelector.keys()]]);
}

// What matches the selectors of `bySelector`, in its order. `null`: not asked for yet.
let matches = null;

// The `Program`.
function program() {
  if (tree === null) {
    // Once the listeners are known, what matches comes with the tree.
    const count = isTraversing ? bySelector.size : 0;
    ask(NEEDS_AST, isTraversing ? selectorRequest() : "[[],[]]", AST);
    tree = readTree(buffers[AST], count);
    if (isTraversing) matches = tree.matches;
    makeNodes();
    const root = nodes[0];
    Object.defineProperty(root, "comments", { get: comments, enumerable: true, configurable: true });
    Object.defineProperty(root, "tokens", { get: tokens, enumerable: true, configurable: true });
  }
  return nodes[0];
}

function dialect() {
  program();
  return tree.dialect;
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
function emitCodePathEvent(name, ...args) {
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
    byNode.set(id, list.flatMap(it => it.calls));
  }
  return byNode;
}

function traverse() {
  isTraversing = true;
  program();
  if (matches === null && bySelector.size > 0) {
    ask(NEEDS_MATCHES, selectorRequest(), MATCHES);
    matches = readMatches(new Uint32Array(buffers[MATCHES], 0, header[0] >> 2), bySelector.size);
  }
  for (const { selector } of bySelector.values()) {
    if (selector.error !== null) throw new SyntaxError(selector.error);
  }
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
  const analyzer = codePathCalls === null ? null : new CodePathAnalyzer(enter, leave);
  const enterNode = analyzer === null ? enter : id => analyzer.enterNode(nodes[id], id);
  const leaveNode = analyzer === null ? leave : id => analyzer.leaveNode(nodes[id], id);
  const last = lastDescendants();
  // The nodes that are entered and have to be left.
  const open = [];
  for (let id = 0; id < count; id++) {
    while (open.length > 0 && last[open.at(-1)] < id) leaveNode(open.pop());
    enterNode(id);
    if (visitedTwice?.has(id)) {
      leaveNode(id);
      enterNode(id);
    }
    if (analyzer !== null || exitCalls(id) !== undefined) open.push(id);
  }
  while (open.length > 0) leaveNode(open.pop());
}

// ───────────── a file ─────────────

function reset() {
  text = "";
  lineStarts = lines = null;
  tree = null;
  nodes = [];
  descendants = matches = null;
  enterByType = [];
  exitByType = [];
  bySelector = new Map();
  codePathCalls = null;
  hasListeners = hasExitListeners = isTraversing = false;
  currentRule = currentNode = null;
  reports = [];
  resetTokens();
  resetScopes();
}

function lint() {
  const buffer = buffers[LINT];
  const [flags, settingsId, count, pathLength] = new Uint32Array(buffer, 0, 4);
  const ids = new Uint32Array(buffer, 16, count);
  const pathStart = 16 + 4 * count;
  wantsFixes = (flags & 1) !== 0;
  hasBOM = (flags & 2) !== 0;
  filename = decoder.decode(new Uint8Array(buffer, pathStart, pathLength));
  text = decoder.decode(new Uint8Array(buffer, pathStart + pathLength, header[0] - pathStart - pathLength));
  fileSettings = allSettings.get(settingsId);
  for (let position = 0; position < count; position++) {
    const entry = configured.get(ids[position]);
    entry.position = position;
    currentRule = entry;
    const listeners = entry.rule.create(entry.context);
    if (listeners === undefined || listeners === null) {
      throw new Error(`The create() function for rule '${entry.ruleId}' did not return an object.`);
    }
    addListeners(entry, listeners);
  }
  if (hasListeners) traverse();
}

for (;;) {
  const kind = next();
  switch (kind) {
    case START: {
      const start = JSON.parse(contentAsText(kind));
      cwd = start.cwd;
      defineTypes(start.types, start.strings);
      break;
    }
    case LOAD:
      try {
        send(LOADED, JSON.stringify(await loadPlugin(JSON.parse(contentAsText(kind)))));
      } catch (error) {
        send(FAILED, String(error?.stack ?? error));
      }
      break;
    case SETTINGS: {
      const [id, settings] = JSON.parse(contentAsText(kind));
      allSettings.set(id, deepFreeze(settings));
      break;
    }
    case CONFIGURE:
      configure(JSON.parse(contentAsText(kind)));
      break;
    case LINT:
      try {
        lint();
        send(DONE, reports.length === 0 ? "" : JSON.stringify(reports));
      } catch (error) {
        let message = String(error?.message ?? error);
        if (currentNode !== null) message += `\nOccurred at line ${currentNode.loc.start.line}`;
        send(FAILED, JSON.stringify([currentRule?.position ?? null, message, String(error?.stack ?? "")]));
      }
      reset();
      break;
    default:
      throw new Error(`Unexpected message ${kind}.`);
  }
}
