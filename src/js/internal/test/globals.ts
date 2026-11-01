// Called by VirtualMachine.rs. With `bun test --isolate=modules`, all test files share one global object,
// so after each file we restore what it changed: globals, builtins, `process.env` and `process` listeners.

const isEnvironmentGlobal: (key: PropertyKey) => boolean = require("internal/test/environment").isEnvironmentGlobal;
const shapesOf: (objects: object[]) => unknown[] = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionShapesOfObjects",
  1,
);
const indexesOfChanged: (objects: object[], shapes: unknown[]) => number[] = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionIndexesOfChangedObjects",
  2,
);
// Also deletes a property that isn't configurable.
const deleteOwnProperty: (object: object, key: PropertyKey) => boolean = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionDeleteOwnProperty",
  2,
);

// Builtin modules are loaded once and shared by all files. These two patch `Performance.prototype` and
// `MessagePort.prototype` on load, so load them before the snapshot. Otherwise the restore would remove their patches.
require("node:perf_hooks");
require("node:worker_threads");

// This module is evaluated before any test file runs. Test files can patch builtins later,
// so only use what's captured here, $-private names, index loops and null-prototype descriptors.
const { getPrototypeOf, getOwnPropertyDescriptor, defineProperty, getOwnPropertyNames } = Object;
const { ownKeys } = Reflect;
const { eventNames, rawListeners, removeListener } = process;

type Properties = Map<PropertyKey, PropertyDescriptor>;

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

const objects: object[] = [];
const savedProperties: Properties[] = [];
const savedPropertyCounts: number[] = [];
const seen = new Map<object, true>();
// Nearly all of the objects are untouched by a test file. Native code tells which ones may not be.
let shapes: unknown[];
let alwaysComparedCount: number;
let env: Map<string, string | undefined>;
let listeners: Map<string | symbol, Function[]>;

function getDescriptor(object: object, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor && ({ __proto__: null, ...descriptor } as PropertyDescriptor);
}

function isTracked(object: object, key: PropertyKey) {
  if (object === globalThis) return true;
  // Underscore-prefixed properties hold internal state, like `process._events`.
  if (typeof key === "string" && key.$charCodeAt(0) === 95) return false;
  return !((object === process || object === Bun) && skippedKeys.$has(key as string));
}

// Walks globalThis, its object properties, every function reachable from those, and their prototypes.
function saveProperties(object: object, isGlobalThis: boolean) {
  if (seen.$has(object)) return;
  seen.$set(object, true);
  const properties: Properties = new Map();
  const index = objects.length;
  $arrayPush(objects, object);
  $arrayPush(savedProperties, properties);
  $arrayPush(savedPropertyCounts, 0);
  const keys = ownKeys(object);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!isTracked(object, key)) continue;
    const descriptor = getDescriptor(object, key);
    if (!descriptor) continue;
    properties.$set(key, descriptor);
    savedPropertyCounts[index]++;
    const { value, get, set } = descriptor;
    if (
      typeof value === "function" ||
      (typeof value === "object" && value !== null && (isGlobalThis || key === "prototype"))
    )
      saveProperties(value, false);
    if (get) saveProperties(get, false);
    if (set) saveProperties(set, false);
  }
  const prototype = getPrototypeOf(object);
  if (prototype) saveProperties(prototype, false);
}

// `current` inherits from Object.prototype, which a test file may have added to.
function isSame(current: PropertyDescriptor, saved: PropertyDescriptor) {
  const x = $getByIdDirect(current, "value");
  const y = saved.value;
  return (
    (x === y ? x !== 0 || 1 / x === 1 / y : x !== x && y !== y) &&
    $getByIdDirect(current, "get") === saved.get &&
    $getByIdDirect(current, "set") === saved.set
  );
}

function restoreProperties(object: object, properties: Properties, size: number) {
  const keys = ownKeys(object);
  let found = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const saved = properties.$get(key);
    if (saved) found++;
    // The next file's window replaces these.
    if (object === globalThis && isEnvironmentGlobal(key)) continue;
    if (!saved) {
      if (isTracked(object, key)) deleteOwnProperty(object, key);
      continue;
    }
    const current = getOwnPropertyDescriptor(object, key)!;
    if (isSame(current, saved)) continue;
    if (!$getByIdDirect(current, "configurable")) {
      if (saved.configurable) deleteOwnProperty(object, key);
      // Some builtins have a read-only property that gives a new value each time it's read.
      else if (!$getByIdDirect(current, "writable")) continue;
    }
    defineProperty(object, key, saved);
  }
  if (found === size) return;
  properties.$forEach((saved, key) => {
    if (!getOwnPropertyDescriptor(object, key)) defineProperty(object, key, saved);
  });
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

function saveShapes() {
  shapes = shapesOf(objects);
  alwaysComparedCount = indexesOfChanged(objects, shapes).length;
}

// The first call takes the snapshot. Later calls restore it.
export default function restoreGlobals() {
  if (!env) {
    saveProperties(globalThis, true);
    saveShapes();
    env = new Map();
    const keys = getOwnPropertyNames(process.env);
    for (let i = 0; i < keys.length; i++) env.$set(keys[i], process.env[keys[i]]);
    listeners = new Map();
    const names = eventNames.$call(process);
    for (let i = 0; i < names.length; i++) listeners.$set(names[i], rawListeners.$call(process, names[i]));
    return;
  }
  const changed = indexesOfChanged(objects, shapes);
  for (let i = 0; i < changed.length; i++) {
    const index = changed[i];
    try {
      restoreProperties(objects[index], savedProperties[index], savedPropertyCounts[index]);
    } catch {}
  }
  // A property that was deleted and put back is in another slot.
  if (changed.length !== alwaysComparedCount) saveShapes();
  restoreEnv();
  restoreListeners();
}
