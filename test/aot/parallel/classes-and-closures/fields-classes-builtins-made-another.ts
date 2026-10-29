// Classes with fields stand over built-in classes. Their objects are also made for a class further down and for a function that is no class of the chain.
const computed1 = Symbol.for("computed1");
class List<T> extends Array<T> {
  extra = "own";
  [computed1] = 2;
  #hidden = 3;
  static count = 0;
  hidden() {
    return this.#hidden;
  }
}
class Longer<T> extends List<T> {
  more = this.extra + "!";
}
class Table extends Map<string, number> {
  label = "table";
  sum() {
    let total = 0;
    for (const value of this.values()) total += value;
    return total;
  }
}
class Failure extends Error {
  code = 7;
}
function Other(this: unknown) {}
Other.prototype = { tag: "other" };

function describe(name: string, value: any) {
  console.log(name, value.extra, value[computed1], value.more, value.label, value.code, value.tag, Object.keys(value).join());
}
for (let round = 0; round < 3; round++) {
  describe("list", new List<number>());
  describe("longer", new Longer<number>());
  describe("list for longer", Reflect.construct(List, [], Longer));
  describe("list for other", Reflect.construct(List, [], Other));
  describe("table", new Table([["a", 1]]));
  describe("table for other", Reflect.construct(Table, [], Other));
  describe("failure", new Failure("no"));
  describe("failure for list", Reflect.construct(Failure, ["no"], List));
}
console.log(new Longer<number>().hidden(), List.prototype.hidden.call(Reflect.construct(List, [], Other)), new Table([["a", 1], ["b", 2]]).sum(), List.count);
