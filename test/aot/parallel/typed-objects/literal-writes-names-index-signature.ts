// A literal under a type with fields and an index signature writes names of both kinds. Every road to those names answers as in plain Bun.
interface Bag {
  size: number;
  [key: string]: number | string;
}
interface Options {
  name?: string;
  depth?: number;
  [key: string]: unknown;
}

const lines: string[] = [];
function show(label: string, value: unknown) {
  lines.push(label + " " + JSON.stringify(value));
}

function make(i: number): Bag {
  return { size: i, a: i + 1, b: "b" + i };
}
function sum(bag: Bag): number {
  return bag.size + (typeof bag.a === "number" ? bag.a : -1);
}
function readBy(bag: Bag, key: string): number | string {
  return bag[key];
}
function storeBy(bag: Bag, key: string, value: number | string) {
  bag[key] = value;
}

const constant: Bag = { size: 4, a: 1, b: 2 };
show("constant", [constant.size, constant.a, constant.b, constant.c, Object.keys(constant)]);

let total = 0;
for (let i = 0; i < 2000; i++) total += sum(make(i));
show("total", total);

const bag = make(1);
bag.a = "text";
show("another type by name", [bag.a, sum(bag), typeof bag.a]);
storeBy(bag, "a", 2.5);
show("a fraction by key", [bag.a, readBy(bag, "a"), sum(bag)]);
storeBy(bag, "size", 9);
show("a field by key", [bag.size, readBy(bag, "size")]);
storeBy(bag, "later", "added");
show("a new name", [bag.later, Object.keys(bag), JSON.stringify(bag)]);
delete bag.a;
show("deleted", [bag.a, "a" in bag, Object.keys(bag), sum(bag)]);
bag.a = 7;
show("back again", [bag.a, Object.keys(bag), sum(bag)]);

const plain: Bag = { size: 1 };
const mixed: Bag[] = [plain, make(2), constant, { size: 3, z: "z" }, { size: 5, a: "a", ["c" + (total % 2)]: 1 }];
show(
  "mixed",
  mixed.map(each => [each.size, each.a, each.z, sum(each), Object.keys(each).join()]),
);
for (const each of mixed) each.a = each.size;
show(
  "mixed stored",
  mixed.map(each => [each.a, sum(each), Object.keys(each).join()]),
);

const copy: Bag = { ...make(3), size: 8, d: 4 };
show("copy", [copy, Object.entries(copy)]);
const { size, ...rest } = make(4);
show("rest", [size, rest]);

function describe(options: Options): string {
  return [options.name, options.depth, options.extra, Object.keys(options).length].join("|");
}
show("options", [
  describe({}),
  describe({ name: "n" }),
  describe({ extra: [1], depth: 2 }),
  describe({ name: "n", extra: null, other: {} }),
]);

const frozen: Bag = Object.freeze({ size: 1, a: 2 });
try {
  ("use strict");
  frozen.a = 3;
} catch (error) {
  show("frozen throws", (error as Error).constructor.name);
}
show("frozen", [frozen.a, Object.isFrozen(frozen)]);

const withAccessor: Bag = {
  size: 1,
  get a() {
    return this.size + 1;
  },
  b: 3,
};
withAccessor.size = 10;
show("accessor", [withAccessor.a, withAccessor.b, sum(withAccessor)]);

Object.defineProperty(constant, "a", { value: 100, enumerable: false, configurable: true, writable: true });
show("redefined", [constant.a, Object.keys(constant), sum(constant)]);

console.log(lines.join("\n"));
