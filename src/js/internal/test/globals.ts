// Called by VirtualMachine.rs. With `bun test --isolate=modules`, all test files share one global object,
// so after each file we restore what it changed: globals, builtins, `process.env` and `process` listeners.

const isEnvironmentGlobal: (key: PropertyKey) => boolean = require("internal/test/environment").isEnvironmentGlobal;
const SavedProperties = require("internal/test/saved_properties");
type SavedProperties = InstanceType<typeof SavedProperties>;

// Builtin modules are loaded once and shared by all files. These two patch `Performance.prototype` and
// `MessagePort.prototype` on load, so load them before the snapshot. Otherwise the restore would remove their patches.
require("node:perf_hooks");
require("node:worker_threads");

// This module is evaluated before any test file runs. Test files can patch builtins later,
// so only use what's captured here, $-private names, index loops and null-prototype descriptors.
const { getOwnPropertyNames } = Object;
const { eventNames, rawListeners, removeListener } = process;

// Reading these creates streams and clients. `argv` and `mainModule` depend on the test file.
const skippedKeys = new Set([
  "stdin",
  "stdout",
  "stderr",
  "sql",
  "postgres",
  "redis",
  "s3",
  "secrets",
  "argv",
  "mainModule",
]);

let saved: SavedProperties;
let env: Map<string, string | undefined>;
let listeners: Map<string | symbol, Function[]>;

function isTracked(object: object, key: PropertyKey) {
  if (object === globalThis) return true;
  // Underscore-prefixed properties hold internal state, like `process._events`.
  if (typeof key === "string" && key.$charCodeAt(0) === 95) return false;
  return !((object === process || object === Bun) && skippedKeys.$has(key as string));
}

// The next file's window replaces these.
function isWindowProperty(object: object, key: PropertyKey) {
  return object === globalThis && isEnvironmentGlobal(key);
}

function restoreEnv() {
  const current = process.env;
  const keys = getOwnPropertyNames(current);
  for (let i = 0; i < keys.length; i++) if (!env.$has(keys[i])) delete current[keys[i]];
  env.$forEach((value, key) => {
    if (current[key] === value) return;
    if (value === undefined) delete current[key];
    else current[key] = value;
  });
}

function restoreListeners() {
  const names = eventNames.$call(process);
  for (let i = 0; i < names.length; i++) {
    const saved = listeners.$get(names[i]);
    const current = rawListeners.$call(process, names[i]);
    for (let j = 0; j < current.length; j++) {
      let isSaved = false;
      for (let k = 0; saved && k < saved.length; k++) isSaved ||= saved[k] === current[j];
      if (!isSaved) removeListener.$call(process, names[i], current[j]);
    }
  }
}

// The first call takes the snapshot. Later calls restore it.
export default function restoreGlobals() {
  if (!env) {
    // globalThis, its object properties, every function reachable from those, and their prototypes.
    saved = new SavedProperties(isTracked);
    saved.save(globalThis, true);
    env = new Map();
    const keys = getOwnPropertyNames(process.env);
    for (let i = 0; i < keys.length; i++) env.$set(keys[i], process.env[keys[i]]);
    listeners = new Map();
    const names = eventNames.$call(process);
    for (let i = 0; i < names.length; i++) listeners.$set(names[i], rawListeners.$call(process, names[i]));
    return;
  }
  saved.restore(isWindowProperty);
  restoreEnv();
  restoreListeners();
}
