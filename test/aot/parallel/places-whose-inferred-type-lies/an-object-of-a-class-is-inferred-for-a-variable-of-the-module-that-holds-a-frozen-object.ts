// `Pair` is what the checker infers. The place holds a frozen object.
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
const held = taken<Pair>(Object.freeze(new Pair()));
function use0(): unknown { return held.first; }
function use1(): unknown { return held.second; }
function use2(): unknown { return held.sum(); }
function use3(): unknown { let total: any = 0; for (let at = 0; at < 3; at++) total += held.first; return total; }
function use4(): unknown { held.first = 5; return held.sum(); }
for (let round = 0; round < 3; round++) console.log(attempt(use0), attempt(use1), attempt(use2), attempt(use3), attempt(use4));
