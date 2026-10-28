// Error.captureStackTrace() and the date setters of fs.Stats throw the same TypeError as an assignment when their target is a read-only built-in object. Plain Bun defines the property.
import { Stats } from "node:fs";

const keyOf = k => [k][0];
const builtins = {
  "Object.prototype": Object.prototype,
  "Function.prototype": Function.prototype,
  "RegExp.prototype": RegExp.prototype,
  "Promise.prototype": Promise.prototype,
  "the prototype of generators": Object.getPrototypeOf(function* () {}).prototype,
  "the prototype of async generators": Object.getPrototypeOf(async function* () {}).prototype,
  "the prototype of generator functions": Object.getPrototypeOf(function* () {}),
  "Request.prototype": Request.prototype,
  "Response.prototype": Response.prototype,
  "Headers.prototype": Headers.prototype,
  "Blob.prototype": Blob.prototype,
  "URL.prototype": URL.prototype,
  "URLSearchParams.prototype": URLSearchParams.prototype,
  "Array.prototype": Array.prototype,
  "String.prototype": String.prototype,
  "Map.prototype": Map.prototype,
  "Error.prototype": Error.prototype,
  Math,
  JSON,
  Reflect,
  Array,
  Promise,
  "Math.max": Math.max,
  console,
  process,
};
const ways = {
  "Error.captureStackTrace": ["stack", o => Error.captureStackTrace(o)],
  "Error.captureStackTrace with Error.prepareStackTrace": [
    "stack",
    o => {
      Error.prepareStackTrace = () => "prepared";
      try {
        Error.captureStackTrace(o);
      } finally {
        Error.prepareStackTrace = undefined;
      }
    },
  ],
  "the setter of atime": ["atime", o => Reflect.set(Stats.prototype, "atime", "stored", o)],
};
const literal = { a: 1 };
function ordinary() {}

for (const [way, [name, define]] of Object.entries(ways)) {
  for (const [text, o] of Object.entries(builtins)) {
    let answer;
    try {
      answer = String(define(o));
    } catch (e) {
      answer = e.constructor.name + ": " + e.message.split(" because ")[0];
    }
    console.log(
      way,
      "|",
      text,
      "|",
      answer,
      "|",
      typeof o[keyOf(name)],
      Object.hasOwn(o, keyOf(name)),
      typeof literal[keyOf(name)],
      typeof ordinary[keyOf(name)],
    );
    for (const added of [name, "originalLine", "originalColumn"]) Reflect.deleteProperty(o, keyOf(added));
  }
}
console.log(typeof literal.stack, typeof literal.atime, typeof ordinary.stack, typeof ordinary.atime);
