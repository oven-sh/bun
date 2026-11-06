// Error.captureStackTrace() and the date setters of fs.Stats throw the same TypeError as an assignment when their target is a read-only built-in object. Plain Bun defines the property.
// Alone: it adds properties to built-in objects
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
/* Output:
Error.captureStackTrace | Object.prototype | TypeError: Cannot assign to Object.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Function.prototype | TypeError: Cannot assign to Function.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | RegExp.prototype | TypeError: Cannot assign to RegExp.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Promise.prototype | TypeError: Cannot assign to Promise.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | the prototype of generators | TypeError: Cannot assign to %Generator%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | the prototype of async generators | TypeError: Cannot assign to %AsyncGenerator%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | the prototype of generator functions | TypeError: Cannot assign to %GeneratorFunction%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Request.prototype | TypeError: Cannot assign to Request.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Response.prototype | TypeError: Cannot assign to Response.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Headers.prototype | TypeError: Cannot assign to Headers.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Blob.prototype | TypeError: Cannot assign to Blob.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | URL.prototype | TypeError: Cannot assign to URL.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | URLSearchParams.prototype | TypeError: Cannot assign to URLSearchParams.prototype.stack | undefined false undefined undefined
Error.captureStackTrace | Array.prototype | undefined | string true undefined undefined
Error.captureStackTrace | String.prototype | undefined | string true undefined undefined
Error.captureStackTrace | Map.prototype | undefined | string true undefined undefined
Error.captureStackTrace | Error.prototype | undefined | string true undefined undefined
Error.captureStackTrace | Math | undefined | string true undefined undefined
Error.captureStackTrace | JSON | undefined | string true undefined undefined
Error.captureStackTrace | Reflect | undefined | string true undefined undefined
Error.captureStackTrace | Array | undefined | string true undefined undefined
Error.captureStackTrace | Promise | undefined | string true undefined undefined
Error.captureStackTrace | Math.max | undefined | string true undefined undefined
Error.captureStackTrace | console | undefined | string true undefined undefined
Error.captureStackTrace | process | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Object.prototype | TypeError: Cannot assign to Object.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Function.prototype | TypeError: Cannot assign to Function.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | RegExp.prototype | TypeError: Cannot assign to RegExp.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Promise.prototype | TypeError: Cannot assign to Promise.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | the prototype of generators | TypeError: Cannot assign to %Generator%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | the prototype of async generators | TypeError: Cannot assign to %AsyncGenerator%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | the prototype of generator functions | TypeError: Cannot assign to %GeneratorFunction%.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Request.prototype | TypeError: Cannot assign to Request.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Response.prototype | TypeError: Cannot assign to Response.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Headers.prototype | TypeError: Cannot assign to Headers.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Blob.prototype | TypeError: Cannot assign to Blob.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | URL.prototype | TypeError: Cannot assign to URL.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | URLSearchParams.prototype | TypeError: Cannot assign to URLSearchParams.prototype.stack | undefined false undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Array.prototype | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | String.prototype | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Map.prototype | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Error.prototype | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Math | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | JSON | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Reflect | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Array | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Promise | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | Math.max | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | console | undefined | string true undefined undefined
Error.captureStackTrace with Error.prepareStackTrace | process | undefined | string true undefined undefined
the setter of atime | Object.prototype | TypeError: Cannot assign to Object.prototype.atime | undefined false undefined undefined
the setter of atime | Function.prototype | TypeError: Cannot assign to Function.prototype.atime | undefined false undefined undefined
the setter of atime | RegExp.prototype | TypeError: Cannot assign to RegExp.prototype.atime | undefined false undefined undefined
the setter of atime | Promise.prototype | TypeError: Cannot assign to Promise.prototype.atime | undefined false undefined undefined
the setter of atime | the prototype of generators | TypeError: Cannot assign to %Generator%.prototype.atime | undefined false undefined undefined
the setter of atime | the prototype of async generators | TypeError: Cannot assign to %AsyncGenerator%.prototype.atime | undefined false undefined undefined
the setter of atime | the prototype of generator functions | TypeError: Cannot assign to %GeneratorFunction%.prototype.atime | undefined false undefined undefined
the setter of atime | Request.prototype | TypeError: Cannot assign to Request.prototype.atime | undefined false undefined undefined
the setter of atime | Response.prototype | TypeError: Cannot assign to Response.prototype.atime | undefined false undefined undefined
the setter of atime | Headers.prototype | TypeError: Cannot assign to Headers.prototype.atime | undefined false undefined undefined
the setter of atime | Blob.prototype | TypeError: Cannot assign to Blob.prototype.atime | undefined false undefined undefined
the setter of atime | URL.prototype | TypeError: Cannot assign to URL.prototype.atime | undefined false undefined undefined
the setter of atime | URLSearchParams.prototype | TypeError: Cannot assign to URLSearchParams.prototype.atime | undefined false undefined undefined
the setter of atime | Array.prototype | true | string true undefined undefined
the setter of atime | String.prototype | true | string true undefined undefined
the setter of atime | Map.prototype | true | string true undefined undefined
the setter of atime | Error.prototype | true | string true undefined undefined
the setter of atime | Math | true | string true undefined undefined
the setter of atime | JSON | true | string true undefined undefined
the setter of atime | Reflect | true | string true undefined undefined
the setter of atime | Array | true | string true undefined undefined
the setter of atime | Promise | true | string true undefined undefined
the setter of atime | Math.max | true | string true undefined undefined
the setter of atime | console | true | string true undefined undefined
the setter of atime | process | true | string true undefined undefined
undefined undefined undefined undefined
*/
