// Counts, while a deed runs, every call of a public built-in function and every read of an option's name that climbs to Object.prototype.
// It calls nothing that it counts: what it needs of Reflect is taken in front, and lists grow by a store at their length.
const { apply, construct, ownKeys, getOwnPropertyDescriptor, defineProperty } = Reflect;
const holders = {
  Object, "Object.prototype": Object.prototype, Array, "Array.prototype": Array.prototype, "Function.prototype": Function.prototype, Reflect,
  String, "String.prototype": String.prototype, "RegExp.prototype": RegExp.prototype, "Map.prototype": Map.prototype, "Set.prototype": Set.prototype,
  "WeakMap.prototype": WeakMap.prototype, Promise, "Promise.prototype": Promise.prototype, JSON, Number, "Number.prototype": Number.prototype, Math, Symbol,
  Buffer, "Buffer.prototype": Buffer.prototype, "Uint8Array.prototype": Uint8Array.prototype, "TypedArray.prototype": Object.getPrototypeOf(Uint8Array.prototype),
};

export const counts = { __proto__: null };
let counting = false;
const restores = [];
export const refused = [];
function countedRead(option) {
  const name = "read off Object.prototype: " + option;
  restores[restores.length] = () => delete Object.prototype[option];
  return {
    __proto__: null,
    configurable: true,
    get() { if (counting) counts[name] = (counts[name] | 0) + 1; return undefined; },
    set(value) { defineProperty(this, option, { __proto__: null, value, writable: true, enumerable: true, configurable: true }); },
  };
}
export function lay() {
  for (const label in holders) {
    const holder = holders[label];
    for (const key of ownKeys(holder)) {
      const descriptor = getOwnPropertyDescriptor(holder, key);
      const original = descriptor.value;
      if (typeof original !== "function" || !descriptor.configurable || key === "constructor") continue;
      const name = label + "." + (typeof key === "symbol" ? "[" + key.description + "]" : key);
      const counted = function (...rest) {
        if (counting) counts[name] = (counts[name] | 0) + 1;
        return new.target ? construct(original, rest, new.target) : apply(original, this, rest);
      };
      try {
        defineProperty(holder, key, { __proto__: null, ...descriptor, value: counted });
      } catch {
        refused[refused.length] = name;
        continue;
      }
      restores[restores.length] = () => defineProperty(holder, key, { __proto__: null, ...descriptor });
    }
  }
  // Each name is written out: a compiled test run lets a test add to Object.prototype only what the build has seen it add.
  Object.defineProperty(Object.prototype, "emitClose", countedRead("emitClose"));
  Object.defineProperty(Object.prototype, "autoDestroy", countedRead("autoDestroy"));
  Object.defineProperty(Object.prototype, "defaultEncoding", countedRead("defaultEncoding"));
  Object.defineProperty(Object.prototype, "encoding", countedRead("encoding"));
  Object.defineProperty(Object.prototype, "read", countedRead("read"));
  Object.defineProperty(Object.prototype, "write", countedRead("write"));
  Object.defineProperty(Object.prototype, "writev", countedRead("writev"));
  Object.defineProperty(Object.prototype, "final", countedRead("final"));
  Object.defineProperty(Object.prototype, "flush", countedRead("flush"));
  Object.defineProperty(Object.prototype, "transform", countedRead("transform"));
  Object.defineProperty(Object.prototype, "destroy", countedRead("destroy"));
  Object.defineProperty(Object.prototype, "construct", countedRead("construct"));
  Object.defineProperty(Object.prototype, "signal", countedRead("signal"));
  Object.defineProperty(Object.prototype, "captureRejections", countedRead("captureRejections"));
  Object.defineProperty(Object.prototype, "highWaterMark", countedRead("highWaterMark"));
  Object.defineProperty(Object.prototype, "objectMode", countedRead("objectMode"));
  Object.defineProperty(Object.prototype, "readableObjectMode", countedRead("readableObjectMode"));
  Object.defineProperty(Object.prototype, "writableObjectMode", countedRead("writableObjectMode"));
  Object.defineProperty(Object.prototype, "decodeStrings", countedRead("decodeStrings"));
  Object.defineProperty(Object.prototype, "allowHalfOpen", countedRead("allowHalfOpen"));
  Object.defineProperty(Object.prototype, "end", countedRead("end"));
  Object.defineProperty(Object.prototype, "_readableState", countedRead("_readableState"));
  Object.defineProperty(Object.prototype, "_writableState", countedRead("_writableState"));
  Object.defineProperty(Object.prototype, "pipe", countedRead("pipe"));
  Object.defineProperty(Object.prototype, "readable", countedRead("readable"));
  Object.defineProperty(Object.prototype, "headers", countedRead("headers"));
  Object.defineProperty(Object.prototype, "method", countedRead("method"));
  Object.defineProperty(Object.prototype, "host", countedRead("host"));
  Object.defineProperty(Object.prototype, "port", countedRead("port"));
  Object.defineProperty(Object.prototype, "path", countedRead("path"));
  Object.defineProperty(Object.prototype, "agent", countedRead("agent"));
  Object.defineProperty(Object.prototype, "timeout", countedRead("timeout"));
  Object.defineProperty(Object.prototype, "keepAlive", countedRead("keepAlive"));
}
export function restore() { counting = false; for (let i = restores.length - 1; i >= 0; i--) restores[i](); restores.length = 0; }
export async function during(label, deed) {
  const before = { __proto__: null, ...counts };
  counting = true;
  try { await deed(); } finally { counting = false; }
  const said = [];
  for (const name in counts) if (counts[name] !== (before[name] | 0)) said[said.length] = name + " " + (counts[name] - (before[name] | 0));
  return [label, said];
}
