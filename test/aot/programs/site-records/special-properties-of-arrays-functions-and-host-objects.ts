// `length`, `name`, `size`, `lastIndex`, `byteLength`, `prototype`: on some kinds of objects the engine computes them, refuses stores to them, or does more than store. Such objects arrive at reads and stores that expect a plain field.
interface Plain {
  length: number;
  name: string;
  size: number;
  lastIndex: number;
  byteLength: number;
  prototype: unknown;
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "object" && value !== null ? "object" : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function readAll(plain: Plain): string {
  return [attempt(() => plain.length), attempt(() => plain.name), attempt(() => plain.size), attempt(() => plain.lastIndex), attempt(() => plain.byteLength), attempt(() => plain.prototype)].join(" ");
}
function setLength(plain: Plain, to: number): void {
  plain.length = to;
}
function setName(plain: Plain, to: string): void {
  plain.name = to;
}
function setSize(plain: Plain, to: number): void {
  plain.size = to;
}
function setLastIndex(plain: Plain, to: number): void {
  plain.lastIndex = to;
}
function setPrototypeField(plain: Plain, to: unknown): void {
  plain.prototype = to;
}
function look(mark: string, value: unknown, after: () => unknown = () => ""): void {
  const plain = value as Plain;
  console.log(mark + ":", readAll(plain));
  console.log("  stores:", attempt(() => setLength(plain, 1)), attempt(() => setName(plain, "renamed")), attempt(() => setSize(plain, 2)), attempt(() => setLastIndex(plain, 3)), attempt(() => setPrototypeField(plain, null)));
  console.log("  then:", readAll(plain), Object.keys(plain).join(), String(after()));
}

function honest(): Plain {
  return { length: 9, name: "honest", size: 9, lastIndex: 9, byteLength: 9, prototype: 9 };
}
function ordinary(first: number, second: number) {
  return first + second;
}
class Klass {
  static size = 4;
}

const list = [1, 2, 3];
const sparse = [1, , 3, , 5];
const pattern = /a/g;
const frozenList = Object.freeze([1, 2, 3]);

look("honest", honest());
look("array", list, () => JSON.stringify(list));
look("array with holes", sparse, () => JSON.stringify(sparse));
look("frozen array", frozenList, () => JSON.stringify(frozenList));
look("honest", honest());
look("function", ordinary, () => ordinary(1, 2));
look("arrow", () => 0);
look("class", Klass, () => Klass.size);
look("bound function", ordinary.bind(null));
look("method", { method() {} }.method);
look("honest", honest());
look("map", new Map([[1, 1]]));
look("set", new Set([1, 2]));
look("regular expression", pattern, () => pattern.test("aaaa") + " " + pattern.lastIndex);
look("array buffer", new ArrayBuffer(8));
look("typed array", new Float64Array(4));
look("data view", new DataView(new ArrayBuffer(16), 4));
look("string object", new String("boxed"));
look("arguments", (function (..._: number[]) {
  return arguments;
})(1, 2, 3));
look("honest", honest());

console.log("negative length:", attempt(() => setLength([1, 2] as any, -1)), "fraction:", attempt(() => setLength([1, 2] as any, 1.5)), "text:", attempt(() => setLength([1, 2] as any, "1" as any)));

export {};
