// Called by VirtualMachine.rs. With `bun test --isolate=modules` every test file runs in the one global object,
// so what a file changed about it, the builtins, `process.env` and the listeners of `process` is undone when the file ends.

const isNameOfEnvironment: (key: PropertyKey) => boolean = require("internal/test/environment").isNameLeftOnGlobalThis;

// This module is first evaluated before any script of a test file. From then on files can patch builtins,
// so use what is captured here, $-private names, index loops and null-prototype descriptors.
const { getPrototypeOf, getOwnPropertyDescriptor, defineProperty, getOwnPropertyNames } = Object;
const { ownKeys } = Reflect;
const { eventNames, rawListeners, removeListener } = process;

type Properties = Map<PropertyKey, PropertyDescriptor>;

// Reading these creates streams and clients. The last two name the test file, and are worked out when first read.
const notRead = new Set([
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
const propertiesOf: Properties[] = [];
const numberOfProperties: number[] = [];
const seen = new Map<object, true>();
let env: Map<string, string | undefined>;
let listeners: Map<string | symbol, Function[]>;

function descriptorOf(object: object, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor && ({ __proto__: null, ...descriptor } as PropertyDescriptor);
}

function isTracked(object: object, key: PropertyKey) {
  if (object === globalThis) return true;
  // The state of an object that is more than its functions, like `process._events`.
  if (typeof key === "string" && key.$charCodeAt(0) === 95) return false;
  return !((object === process || object === Bun) && notRead.$has(key as string));
}

// globalThis, the objects that are its properties, every function those lead to, and their prototypes.
function remember(object: object, isGlobalThis: boolean) {
  if (seen.$has(object)) return;
  seen.$set(object, true);
  const properties: Properties = new Map();
  const index = objects.length;
  $arrayPush(objects, object);
  $arrayPush(propertiesOf, properties);
  $arrayPush(numberOfProperties, 0);
  const keys = ownKeys(object);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!isTracked(object, key)) continue;
    const descriptor = descriptorOf(object, key);
    if (!descriptor) continue;
    properties.$set(key, descriptor);
    numberOfProperties[index]++;
    const { value, get, set } = descriptor;
    if (
      typeof value === "function" ||
      (typeof value === "object" && value !== null && (isGlobalThis || key === "prototype"))
    )
      remember(value, false);
    if (get) remember(get, false);
    if (set) remember(set, false);
  }
  const prototype = getPrototypeOf(object);
  if (prototype) remember(prototype, false);
}

function isSame(a: PropertyDescriptor, b: PropertyDescriptor) {
  const x = a.value;
  const y = b.value;
  return (x === y ? x !== 0 || 1 / x === 1 / y : x !== x && y !== y) && a.get === b.get && a.set === b.set;
}

function undo(object: object, properties: Properties, size: number) {
  const keys = ownKeys(object);
  let found = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const was = properties.$get(key);
    if (was) found++;
    // The next file's window takes them over.
    if (object === globalThis && isNameOfEnvironment(key)) continue;
    if (!was) {
      if (isTracked(object, key)) delete (object as any)[key];
      continue;
    }
    const now = descriptorOf(object, key)!;
    if (!isSame(now, was) && (now.configurable || now.writable)) defineProperty(object, key, was);
  }
  if (found === size) return;
  properties.$forEach((was, key) => {
    if (!getOwnPropertyDescriptor(object, key)) defineProperty(object, key, was);
  });
}

function undoEnv() {
  const now = process.env;
  const keys = getOwnPropertyNames(now);
  for (let i = 0; i < keys.length; i++) if (!env.$has(keys[i])) delete now[keys[i]];
  env.$forEach((value, key) => {
    if (now[key] === value) return;
    if (value === undefined) delete now[key];
    else now[key] = value;
  });
}

function undoListeners() {
  const names = eventNames.$call(process);
  for (let i = 0; i < names.length; i++) {
    const kept = listeners.$get(names[i]);
    const now = rawListeners.$call(process, names[i]);
    for (let j = 0; j < now.length; j++) {
      let isKept = false;
      for (let k = 0; kept && k < kept.length; k++) isKept ||= kept[k] === now[j];
      if (!isKept) removeListener.$call(process, names[i], now[j]);
    }
  }
}

// The first call remembers, each later one puts back.
export default function undoChangesToGlobals() {
  if (!env) {
    remember(globalThis, true);
    env = new Map();
    const keys = getOwnPropertyNames(process.env);
    for (let i = 0; i < keys.length; i++) env.$set(keys[i], process.env[keys[i]]);
    listeners = new Map();
    const names = eventNames.$call(process);
    for (let i = 0; i < names.length; i++) listeners.$set(names[i], rawListeners.$call(process, names[i]));
    return;
  }
  for (let i = 0; i < objects.length; i++) {
    try {
      undo(objects[i], propertiesOf[i], numberOfProperties[i]);
    } catch {}
  }
  undoEnv();
  undoListeners();
}
