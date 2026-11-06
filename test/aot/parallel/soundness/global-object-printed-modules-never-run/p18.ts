// Native code rejects the promise of a lookup of a host that does not exist, and the handler that catch() or then() was given gets the error.
function fuzzTry(run: () => any): any {
  try {
    return run();
  } catch (error) {
    console.log("caught " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error));
  }
}
function fuzzText(value: any, depth = 0): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return "function";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  try {
    const keys = Reflect.ownKeys(value);
    let text = "";
    for (let i = 0; i < keys.length && i < 20; i++) {
      if (value instanceof Error && keys[i] !== "message" && keys[i] !== "cause") continue;
      const own: any = Object.getOwnPropertyDescriptor(value, keys[i]);
      text += (i ? "," : "") + String(keys[i]) + (own.enumerable ? "" : "~") + (own.writable === false ? "!" : "") + ":" + ("value" in own ? fuzzText(own.value, depth + 1) : "accessor");
    }
    const prototype = Object.getPrototypeOf(value);
    const name = prototype === null ? "null" : prototype === Object.prototype ? "" : prototype === Array.prototype ? "array" : typeof prototype.constructor === "function" ? prototype.constructor.name : "?";
    // Built-in prototypes and namespaces are locked in a compiled program: whether one is extensible differs by design. The prototypes of the program's own classes go without the letter too.
    if (Object.hasOwn(value, "constructor") || Object.hasOwn(value, Symbol.toStringTag)) return name + "{" + text + "}";
    return name + "{" + text + "}" + (Object.isFrozen(value) ? "F" : Object.isSealed(value) ? "S" : Object.isExtensible(value) ? "" : "P");
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error);
  }
}
const codeOf = (error: unknown) => typeof (error as NodeJS.ErrnoException).code;

console.log(await Bun.dns.lookup("no-such-host.invalid").catch(codeOf));
console.log(await Bun.dns.lookup("no-such-host.invalid").then(() => "found", codeOf));
try {
  Object.assign(codeOf, { sleep: (globalThis as any), log: ([[]] as any) });
} catch (error) {
  console.log("refused " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error));
}
try {
  await Bun.dns.lookup("no-such-host.invalid");
} catch (error) {
  console.log(codeOf(error), error instanceof Error);
}
console.log(await Bun.sleep(1).then(() => "slept", codeOf));

console.log("at the end codeOf " + fuzzTry(() => fuzzText(codeOf)));

export {};
