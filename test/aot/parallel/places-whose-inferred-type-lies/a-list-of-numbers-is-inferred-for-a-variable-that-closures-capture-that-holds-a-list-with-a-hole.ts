// `number[]` is what the checker infers. The place holds a list with a hole.
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
function make() {
  const held = taken<number[]>([1, , 3]);
  function use0(): unknown { let total = 0; for (let at = 0; at < held.length; at++) total += held[at]!; return total; }
  function use1(): unknown { return held.length; }
  function use2(): unknown { return held[1]! * 2; }
  function use3(): unknown { return held.map(each => each + 1).join(); }
  return [use0, use1, use2, use3];
}
const made = make();
for (let round = 0; round < 3; round++) console.log(made.map(attempt).join(", "));
