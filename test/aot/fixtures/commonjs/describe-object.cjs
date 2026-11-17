// Prints everything a program can observe about the own properties of an object, for the programs about the exports object of a CommonJS module.
function show(value) {
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? `[${value.map(show).join()}]` : `{${Object.keys(value).join()}}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const showKeys = keys => keys.map(String).join();
const showProperties = copy => Reflect.ownKeys(copy).map(key => `${String(key)}=${show(copy[key])}`).join();
const showForm = descriptor => `${descriptor.writable === undefined ? "-" : descriptor.writable ? "w" : "_"}${descriptor.enumerable ? "e" : "_"}${descriptor.configurable ? "c" : "_"}`;

function listWithForIn(object) {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
}

function showDescriptors(object) {
  const descriptors = Object.getOwnPropertyDescriptors(object);
  return Reflect.ownKeys(descriptors).map(key => `${String(key)} ${showForm(descriptors[key])}`).join();
}

function copyWithoutFirstKey(object) {
  const [first] = Object.keys(object);
  const { [first]: excluded, ...rest } = object;
  return showProperties(rest);
}

// A proxy without traps asks the object itself, whatever the compiler knows about the object.
function observeThroughProxy(object) {
  const proxy = new Proxy(object, {});
  return `${Object.keys(proxy).join()} | ${showKeys(Reflect.ownKeys(proxy))} | ${showProperties({ ...proxy })}`;
}

function compareWithCopy(object) {
  const copy = { ...object };
  return [Bun.deepEquals(object, copy), Bun.deepEquals(copy, object), Bun.deepEquals(object, copy, true), Bun.deepEquals(copy, object, true)].join(" ");
}

// A function or an accessor that is only created when somebody asks for it is the same object for everybody who asks.
function answersAlike(object, key, descriptor) {
  if ("value" in descriptor) return Object.is(object[key], descriptor.value) && Object.is(Reflect.get(object, key), descriptor.value);
  const again = Object.getOwnPropertyDescriptor(object, key);
  const getter = Object.prototype.__lookupGetter__.call(object, key);
  const setter = Object.prototype.__lookupSetter__.call(object, key);
  return again.get === descriptor.get && again.set === descriptor.set && getter === descriptor.get && setter === descriptor.set;
}

function describeProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  const held = "value" in descriptor ? show(descriptor.value) : `get ${show(descriptor.get)} set ${show(descriptor.set)}`;
  const isFound = key in object && Reflect.has(object, key);
  const isOwn = Object.prototype.hasOwnProperty.call(object, key) && Object.hasOwn(object, key);
  const isListed = Object.prototype.propertyIsEnumerable.call(object, key);
  return `${showForm(descriptor)} ${held} | in ${isFound} own ${isOwn} listed ${isListed} alike ${answersAlike(object, key, descriptor)}`;
}

const lists = [
  ["keys", object => Object.keys(object).join()],
  ["names", object => Object.getOwnPropertyNames(object).join()],
  ["symbols", object => showKeys(Object.getOwnPropertySymbols(object))],
  ["own keys", object => showKeys(Reflect.ownKeys(object))],
  ["for-in", listWithForIn],
  ["entries", object => Object.entries(object).map(([key, value]) => `${key}=${show(value)}`).join()],
  ["values", object => Object.values(object).map(show).join()],
];

// Each of these goes through all the properties. The last four are functions of Bun, which do so in native code.
const walks = [
  ["descriptors", showDescriptors],
  ["json", object => JSON.stringify(object)],
  ["json with a replacer", object => JSON.stringify(object, (key, value) => value)],
  ["spread", object => showProperties({ ...object })],
  ["assign", object => showProperties(Object.assign({}, object))],
  ["rest", copyWithoutFirstKey],
  ["proxy", observeThroughProxy],
  ["state", object => [Object.isExtensible(object), Object.isSealed(object), Object.isFrozen(object), Object.getPrototypeOf(object) === Object.prototype, Object.prototype.toString.call(object)].join(" ")],
  ["Bun.inspect", object => Bun.inspect(object, { depth: 1, compact: true })],
  ["Bun.deepEquals", compareWithCopy],
  ["structuredClone", object => showProperties(structuredClone(object))],
  ["URLSearchParams", object => Array.from(new URLSearchParams(object).keys()).join()],
];

// An observation that throws is an answer too, and the observations after it are still made.
function printAnswer(name, observe, object, key) {
  let answer;
  try {
    answer = observe(object, key);
  } catch (error) {
    answer = `threw ${error instanceof Error ? error.name : show(error)}`;
  }
  console.log(`  ${name} ${answer}`);
}

function describe(label, object) {
  console.log(`${label}:`);
  for (const [name, observe] of lists) printAnswer(name, observe, object);
  for (const key of Reflect.ownKeys(object)) printAnswer(String(key), describeProperty, object, key);
  for (const [name, observe] of walks) printAnswer(name, observe, object);
}

module.exports = { describe, show };
