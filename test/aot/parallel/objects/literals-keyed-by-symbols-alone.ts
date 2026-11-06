// A literal whose only keys are symbols the program does not name at the literal: each may be one symbol, several, or a string that a type says is a symbol.
const first = Symbol("first");
const second = Symbol("second");
const nameless = Symbol();

function one(sym: symbol, value: number): Record<symbol, number> {
  return { [sym]: value };
}
function two(a: symbol, b: symbol): Record<symbol, unknown> {
  return { [a]: 1, [b]: "two" };
}
function untypedKey(key: any, value: any) {
  return { [key]: value } as Record<symbol, unknown>;
}
function show(object: any) {
  return JSON.stringify([
    Object.keys(object),
    Object.getOwnPropertySymbols(object).map(String),
    Object.getOwnPropertySymbols(object).map(symbol => object[symbol]),
    Object.getPrototypeOf(object) === Object.prototype,
  ]);
}

let sum = 0;
for (let i = 0; i < 5000; i++) sum += one(first, i)[first];
console.log(sum);
for (let i = 0; i < 5000; i++) {
  const key = i & 1 ? first : second;
  sum += one(key, i)[key];
}
console.log(sum);

console.log(show(one(first, 1)), show(one(nameless, 2)), show(two(first, second)), show(two(first, first)));
console.log(show(untypedKey(first, 1)), show(untypedKey("text", 2)), show(untypedKey(3, 4)));
console.log(show(untypedKey(Symbol.iterator, 1)), show(untypedKey(Symbol.toPrimitive, () => 5)));
console.log(String(+(untypedKey(Symbol.toPrimitive, () => 5) as any)));

const grown: any = one(first, 1);
grown[second] = 2;
grown.name = "named";
grown[0] = "element";
console.log(show(grown));
delete grown[first];
console.log(show(grown), first in grown, second in grown);
Object.freeze(grown);
console.log(Object.isFrozen(grown), Object.getOwnPropertyDescriptor(grown, second)?.writable);
const descriptors = Object.getOwnPropertyDescriptors(one(first, 9));
console.log(String(Object.getOwnPropertySymbols(descriptors)[0]), JSON.stringify(descriptors[first as any]));
const copy = { ...one(second, 7) };
console.log(copy[second as any], Object.getOwnPropertySymbols(copy).length);
const proxy = new Proxy(one(first, 11), {});
console.log(proxy[first as any], first in proxy);
const merged = Object.assign({}, one(first, 1), one(second, 2));
console.log(show(merged));
