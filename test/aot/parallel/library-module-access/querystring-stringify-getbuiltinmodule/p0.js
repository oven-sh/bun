import { escape } from "node:querystring";
const fuzzLeaked = [];
function fuzzTry(run) {
  try {
    return run();
  } catch (error) {
    console.log("caught " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error));
  }
}
function fuzzText(value, depth = 0) {
  if (typeof value === "number")
    return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "bigint")
    return value + "n";
  if (typeof value === "symbol")
    return String(value);
  if (typeof value === "function")
    return "function";
  if (value === null || typeof value !== "object")
    return String(value);
  if (depth > 2)
    return "..";
  try {
    const keys = Reflect.ownKeys(value);
    let text = "";
    for (let i = 0;i < keys.length && i < 20; i++) {
      if (value instanceof Error && keys[i] !== "message" && keys[i] !== "cause")
        continue;
      const own = Object.getOwnPropertyDescriptor(value, keys[i]);
      text += (i ? "," : "") + String(keys[i]) + (own.enumerable ? "" : "~") + (own.writable === !1 ? "!" : "") + ":" + ("value" in own ? fuzzText(own.value, depth + 1) : "accessor");
    }
    const prototype = Object.getPrototypeOf(value), name = prototype === null ? "null" : prototype === Object.prototype ? "" : prototype === Array.prototype ? "array" : typeof prototype.constructor === "function" ? prototype.constructor.name : "?";
    if (Object.hasOwn(value, "constructor") || Object.hasOwn(value, Symbol.toStringTag))
      return name + "{" + text + "}";
    return name + "{" + text + "}" + (Object.isFrozen(value) ? "F" : Object.isSealed(value) ? "S" : Object.isExtensible(value) ? "" : "P");
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error);
  }
}
const seen = [];
seen.message = Object(1n);
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join(""), name = ["node:", "querystring"].join(""), whole = process.getBuiltinModule.apply(process, [name]), F = whole[key];
for (const leaked of fuzzLeaked)
  fuzzTry(() => {
    leaked.log = Symbol("s");
  });
try {
  console.log("the other member:", String(F({ a: 4294967296 })));
  seen.join = !0;
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " ** error.message);
}
console.log("at the end seen " + fuzzTry(() => fuzzText(seen)));
console.log("at the end key " + fuzzTry(() => fuzzText(key)));
