// Object literals with computed keys. The key turns out to be a named field of the same literal, an index, a symbol, "__proto__", or an object whose conversion has effects. Keys and values are evaluated in the order they are written.
const trail: string[] = [];
const mark = Symbol("mark");

function show(value: object): string {
  return JSON.stringify(value) + " [" + Reflect.ownKeys(value).map(String).join() + "] " + (Object.getPrototypeOf(value) === Object.prototype);
}
function attempt(run: () => object): string {
  try {
    return show(run()) + " " + trail.splice(0).join(";");
  } catch (error) {
    return "throws " + (error as Error).constructor.name + " " + trail.splice(0).join(";");
  }
}
function noted<T>(value: T, name: string): T {
  trail.push(name);
  return value;
}

function keyLast(key: any): object {
  return { a: 1, b: 2, [key]: "computed" };
}
function keyFirst(key: any): object {
  return { [key]: "computed", a: 1, b: 2 };
}
function keyBetween(key: any): object {
  return { a: noted(1, "a"), [noted(key, "key")]: noted("computed", "value"), b: noted(2, "b") };
}
function twoKeys(first: any, second: any): object {
  return { [first]: "first", [second]: "second" };
}
function computedMembers(key: any): object {
  return {
    [key]() {
      return 1;
    },
    get [key + "Getter"]() {
      return 2;
    },
    a: 0,
  };
}
function look(name: string, makeKey: () => unknown, isConvertedByCode = false): void {
  console.log(name + ":");
  console.log("  last:", attempt(() => keyLast(makeKey())));
  console.log("  first:", attempt(() => keyFirst(makeKey())));
  // a-computed-key-is-converted-before-its-value-is-evaluated.ts has the others.
  if (!isConvertedByCode) console.log("  between:", attempt(() => keyBetween(makeKey())));
  console.log("  two:", attempt(() => twoKeys(makeKey(), "b")), "|", attempt(() => twoKeys("a", makeKey())), "|", attempt(() => twoKeys(makeKey(), makeKey())));
  console.log("  members:", attempt(() => computedMembers(makeKey())));
}

look("a new name", () => "c");
look("a named field", () => "a");
look("the other named field", () => "b");
look("put together", () => ["a"].join(""));
look("index", () => 0);
look("index as text", () => "1");
look("negative", () => -1);
look("fraction", () => 1.5);
look("minus zero", () => -0);
look("large", () => 2 ** 32);
look("empty", () => "");
look("symbol", () => mark);
look("well-known symbol", () => Symbol.toStringTag);
look("__proto__", () => "__proto__");
look("constructor", () => "constructor");
look("toJSON", () => "toJSON");
look("null", () => null);
look("undefined", () => undefined);
look("true", () => true);
look("bigint", () => 10n);
look("array", () => ["a"]);
look("an object that converts", () => ({
  toString() {
    trail.push("converted");
    return "a";
  },
}), true);
look("an object that converts by a symbol", () => ({
  [Symbol.toPrimitive](hint: string) {
    trail.push("hint " + hint);
    return mark;
  },
}), true);
look("an object that throws", () => ({
  toString() {
    throw new RangeError("no key");
  },
}), true);
look("an object that cannot be converted", () => Object.create(null), true);

export {};
