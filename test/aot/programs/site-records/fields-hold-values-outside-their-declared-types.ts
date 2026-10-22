// Every kind of declared field gets values outside its type, by every way a value can get in. Typed reads, arithmetic, comparisons and listings see the value that was stored.
class Typed {
  count = 1;
  ratio = 0.5;
  flag = true;
  text = "text";
  list: number[] = [1];
  inner: { deep: number } = { deep: 1 };
  maybe: string | undefined = undefined;
  either: number | string = 1;
  nothing: null = null;
  call: () => number = () => 1;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

function readAll(typed: Typed): string {
  return [typed.count, typed.ratio, typed.flag, typed.text, typed.list, typed.inner, typed.maybe, typed.either, typed.nothing, typed.call].map(show).join(" ");
}
function useAll(typed: Typed): string {
  return [
    attempt(() => typed.count + 1),
    attempt(() => typed.count | 0),
    attempt(() => typed.ratio * 2),
    attempt(() => (typed.flag ? "yes" : "no")),
    attempt(() => !typed.flag),
    attempt(() => typed.text + "!"),
    attempt(() => typed.text.length),
    attempt(() => typed.text === "text"),
    attempt(() => typed.list.length),
    attempt(() => typed.list[0]),
    attempt(() => typed.inner.deep),
    attempt(() => typed.maybe === undefined),
    attempt(() => typeof typed.either),
    attempt(() => typed.nothing === null),
    attempt(() => typed.call()),
  ].join(" ");
}

const names = ["count", "ratio", "flag", "text", "list", "inner", "maybe", "either", "nothing", "call"] as const;
const values: unknown[] = [undefined, null, 0, -0, 7, 2 ** 31, -(2 ** 31) - 1, 1.5, NaN, Infinity, true, false, "", "seven", 7n, Symbol.for("s"), [], [2.5], {}, { deep: "deep" }, Object.assign(() => "called", { toString: () => "callee" }), new Typed()];

function fillByStore(typed: any, value: unknown): void {
  typed.count = value;
  typed.ratio = value;
  typed.flag = value;
  typed.text = value;
  typed.list = value;
  typed.inner = value;
  typed.maybe = value;
  typed.either = value;
  typed.nothing = value;
  typed.call = value;
}
function fillByTypedStore(typed: Typed, value: any): void {
  typed.count = value;
  typed.ratio = value;
  typed.flag = value;
  typed.text = value;
  typed.list = value;
  typed.inner = value;
  typed.maybe = value;
  typed.either = value;
  typed.nothing = value;
  typed.call = value;
}
function fillByKey(typed: any, value: unknown): void {
  for (const name of names) typed[name] = value;
}
function fillByDefinition(typed: Typed, value: unknown): void {
  for (const name of names) Object.defineProperty(typed, name, { value, writable: true, enumerable: true, configurable: true });
}
function fillByReflection(typed: Typed, value: unknown): void {
  for (const name of names) Reflect.set(typed, name, value);
}
function fillByAssign(typed: Typed, value: unknown): void {
  Object.assign(typed, Object.fromEntries(names.map(name => [name, value])));
}

const ways: [string, (typed: Typed, value: unknown) => void][] = [
  ["store", fillByStore],
  ["typed store", fillByTypedStore],
  ["key", fillByKey],
  ["definition", fillByDefinition],
  ["reflection", fillByReflection],
  ["assign", fillByAssign],
];

for (const [way, fill] of ways) {
  const reused = new Typed();
  for (const value of values) {
    const fresh = new Typed();
    fill(fresh, value);
    fill(reused, value);
    const read = readAll(fresh);
    console.log(way, show(typeof value === "object" && value instanceof Typed ? "a Typed" : value) + ":", read === readAll(reused) ? read : "DIFFERS " + read + " / " + readAll(reused));
    console.log("  ", useAll(fresh));
  }
  fill(reused, 3);
  console.log(way, "at last:", readAll(reused), Object.keys(reused).join());
}

export {};
