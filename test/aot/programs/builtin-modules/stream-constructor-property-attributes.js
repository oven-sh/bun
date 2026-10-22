// The constructors of node:stream are plain functions that Bun's modules turn into classes with $toClass. Their `prototype` and `name` properties have the attributes they have in plain Bun, both prototype chains are linked, and a replaced `prototype` is what the next `new` uses.
const EventEmitter = require("node:events");
const { Stream, Readable, Writable, Duplex, Transform, PassThrough } = require("node:stream");

function describe(holder, name) {
  const descriptor = Object.getOwnPropertyDescriptor(holder, name);
  if (!descriptor) return "absent";
  const value = typeof descriptor.value === "string" ? JSON.stringify(descriptor.value) : typeof descriptor.value;
  return `${value} writable=${descriptor.writable} enumerable=${descriptor.enumerable} configurable=${descriptor.configurable}`;
}

const constructors = [
  ["Stream", Stream, EventEmitter],
  ["Readable", Readable, Stream],
  ["Writable", Writable, Stream],
  ["Duplex", Duplex, Readable],
  ["Transform", Transform, Duplex],
  ["PassThrough", PassThrough, Transform],
];

for (const [title, constructor, base] of constructors) {
  console.log(title);
  console.log("  prototype: " + describe(constructor, "prototype"));
  console.log("  name: " + describe(constructor, "name"));
  console.log("  prototype.constructor: " + describe(constructor.prototype, "constructor"));
  console.log("  constructor is itself: " + (constructor.prototype.constructor === constructor));
  console.log("  inherits statics: " + (Object.getPrototypeOf(constructor) === base));
  console.log("  inherits methods: " + (Object.getPrototypeOf(constructor.prototype) === base.prototype));
}

const original = PassThrough.prototype;
for (let i = 0; i < 100; i++) {
  if (Object.getPrototypeOf(new PassThrough()) !== original) console.log("wrong prototype at " + i);
}

const replacement = Object.create(Transform.prototype);
Object.defineProperty(PassThrough, "prototype", { value: replacement, writable: false, enumerable: true, configurable: false });
console.log("replaced: " + describe(PassThrough, "prototype"));
const stream = new PassThrough();
console.log("new uses the replacement: " + (Object.getPrototypeOf(stream) === replacement));
console.log("instanceof PassThrough: " + (stream instanceof PassThrough));
console.log("instanceof Transform: " + (stream instanceof Transform));
console.log("an earlier instance: " + (Object.create(original) instanceof PassThrough));

Object.defineProperty(Writable, "name", { value: "Renamed" });
console.log("renamed: " + describe(Writable, "name"));
