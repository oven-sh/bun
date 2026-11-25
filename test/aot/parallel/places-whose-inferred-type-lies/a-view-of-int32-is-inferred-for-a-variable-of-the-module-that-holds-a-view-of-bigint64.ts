// `Int32Array` is what the checker infers. The place holds a view of bigint64.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
// Nobody can follow a value through a property of the global object.
function taken<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
class Pair {
  first = 1;
  second = 2;
  sum() { return this.first + this.second; }
}
class Turned {
  second = "two";
  first = "one";
  sum() { return this.second + this.first; }
}
class Words extends Int32Array {
  get length() { return 2; }
}
const held = taken<Int32Array>(BigInt64Array.from([10n, -20n, 30n]));
function use0(): unknown { let total = 0; for (let at = 0; at < 5; at++) total = (Math.imul(total, 31) + (held[at]! >>> 1)) | 0; return total; }
function use1(): unknown { return held.length; }
function use2(): unknown { let text = ""; for (let at = 0; at < held.length; at++) text += show(held[at]) + " "; return text; }
function use3(): unknown { held[1] = 7.5; return held[1]; }
for (let round = 0; round < 3; round++) console.log(attempt(use0), attempt(use1), attempt(use2), attempt(use3));
