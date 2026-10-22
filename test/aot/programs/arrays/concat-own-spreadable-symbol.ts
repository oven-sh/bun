// `concat` spreads an object that compiled code created when its own `Symbol.isConcatSpreadable` is true, whether the literal has the symbol, a store adds it or a definition adds it, and appends the object as one element otherwise.
type Items = { length: number; 0: string; 1: string; [Symbol.isConcatSpreadable]?: boolean };
type Plain = { length: number; 0: string; 1: string };

function concat(value: unknown): string {
  const result = (["head"] as unknown[]).concat(value);
  return `${result.length} ${JSON.stringify(result)}`;
}
function concatAsReceiver(value: unknown): string {
  const result: unknown[] = Array.prototype.concat.call(value, "tail");
  return `${result.length} ${JSON.stringify(result)}`;
}
function show(label: string, value: unknown): void {
  console.log(`${label}: ${concat(value)} | ${concatAsReceiver(value)}`);
}

const absent: Items = { length: 2, 0: "a", 1: "b" };
show("no symbol", absent);
const present: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };
show("true in the literal", present);
show("no symbol, again", absent);
const presentFalse: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: false };
show("false in the literal", presentFalse);
const presentUndefined: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: undefined };
show("undefined in the literal", presentUndefined);

const stored: Items = { length: 2, 0: "a", 1: "b" };
show("before the store", stored);
stored[Symbol.isConcatSpreadable] = true;
show("after the store", stored);
stored[Symbol.isConcatSpreadable] = false;
show("after a store of false", stored);
stored[Symbol.isConcatSpreadable] = true;
delete stored[Symbol.isConcatSpreadable];
show("after the delete", stored);

const undeclared: Plain = { length: 2, 0: "a", 1: "b" };
show("before the undeclared store", undeclared);
(undeclared as any)[Symbol.isConcatSpreadable] = true;
show("after the undeclared store", undeclared);
show("another object of that type", { length: 2, 0: "c", 1: "d" } as Plain);

const defined: Plain = { length: 2, 0: "a", 1: "b" };
Object.defineProperty(defined, Symbol.isConcatSpreadable, { value: true });
show("defined, not enumerable", defined);
let getterCalls = 0;
const withGetter: Plain = { length: 2, 0: "a", 1: "b" };
Object.defineProperty(withGetter, Symbol.isConcatSpreadable, { get: () => (getterCalls++, true) });
show("defined as a getter", withGetter);
console.log("getter calls:", getterCalls);
const literalGetter = {
  length: 1,
  0: "g",
  get [Symbol.isConcatSpreadable](): boolean {
    getterCalls++;
    return true;
  },
};
show("getter in the literal", literalGetter);
console.log("getter calls:", getterCalls);

show("truthy value", { length: 1, 0: "t", [Symbol.isConcatSpreadable]: 1 });
show("falsy value", { length: 1, 0: "f", [Symbol.isConcatSpreadable]: "" });
show("no length", { 0: "n", [Symbol.isConcatSpreadable]: true });
show("holes", { length: 3, 1: "middle", [Symbol.isConcatSpreadable]: true });
show("frozen", Object.freeze({ length: 1, 0: "z", [Symbol.isConcatSpreadable]: true }));
show("copied by spread", { ...present });
show("copied by Object.assign", Object.assign({}, present));
show("inherits from a spreadable object", Object.create(present));

class Fields {
  length = 2;
  0 = "x";
  1 = "y";
  [Symbol.isConcatSpreadable] = true;
}
class WithoutSymbol {
  length = 2;
  0 = "x";
  1 = "y";
}
show("class field", new Fields());
show("class without the symbol", new WithoutSymbol());
const instance = new WithoutSymbol();
(instance as any)[Symbol.isConcatSpreadable] = true;
show("instance after an undeclared store", instance);
show("another instance", new WithoutSymbol());

const list = [1, 2];
show("array", list);
(list as any)[Symbol.isConcatSpreadable] = false;
show("array with an own false", list);
show("another array", [3, 4]);

function createItems(index: number): Items {
  const items: Items = { length: 2, 0: "i" + index, 1: "j" + index };
  if (index % 3 === 0) items[Symbol.isConcatSpreadable] = true;
  return items;
}
let total = 0;
for (let index = 0; index < 300; index++) total += ([] as unknown[]).concat(createItems(index), createItems(index + 1)).length;
console.log("300 pairs:", total);
console.log("several operands:", JSON.stringify(([] as unknown[]).concat(absent, present, [9], presentFalse, "s", stored, undeclared)));

export {};
