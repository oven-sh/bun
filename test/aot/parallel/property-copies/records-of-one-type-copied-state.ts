// Records of one type copied whatever their state.
interface Pair { left: number; right: number }
interface Triple { first: number; second: string; third: Pair | null }
interface Wide {
  a0: number; a1: number; a2: number; a3: number; a4: number; a5: number; a6: number; a7: number; a8: number; a9: number;
  b0: string; b1: string; b2: string; b3: string; b4: string; b5: string; b6: string; b7: string; b8: string; b9: string;
  c0?: number; c1?: string; c2?: Pair;
}
interface Optional { x?: number; y?: number; z?: number }

function copyPair(pair: Pair): Pair { return { ...pair }; }
function copyTriple(triple: Triple): Triple { return { ...triple }; }
function copyWide(wide: Wide): Wide { return { ...wide }; }
function copyOptional(optional: Optional): Optional { return { ...optional }; }
function copyThenSet(triple: Triple, first: number): Triple { return { ...triple, first }; }
function copyInner(triple: Triple, left: number): Triple { return { ...triple, third: { ...triple.third!, left } }; }

function describe(label: string, value: object): void {
  console.log(label, JSON.stringify(value), Object.keys(value).join(), Object.isFrozen(value), Object.isSealed(value), Object.isExtensible(value), Object.getOwnPropertySymbols(value).length);
}

function makeWide(seed: number): Wide {
  return {
    a0: seed, a1: seed + 1, a2: seed + 2, a3: seed + 3, a4: seed + 4, a5: seed + 5.5, a6: seed + 6, a7: seed + 7, a8: seed + 8, a9: 2 ** 40 + seed,
    b0: "b0", b1: "b1" + seed, b2: "b2", b3: "b3", b4: "b4", b5: "b5", b6: "b6", b7: "b7", b8: "b8", b9: "b9" + seed,
  };
}

const pair: Pair = { left: 1, right: 2 };
const triple: Triple = { first: 1, second: "two", third: pair };
describe("pair", copyPair(pair));
describe("triple", copyTriple(triple));
describe("set behind the copy", copyThenSet(triple, 7));
describe("inner copy", copyInner(triple, 9));
console.log(copyTriple(triple).third === pair, copyInner(triple, 9).third === pair, copyPair(pair) === pair);

const wide = makeWide(10);
describe("wide", copyWide(wide));
wide.c1 = "late";
describe("wide with one optional member", copyWide(wide));
wide.c0 = 5;
wide.c2 = pair;
describe("wide with its optional members out of order", copyWide(wide));
delete wide.c1;
describe("wide without one again", copyWide(wide));

describe("frozen", copyPair(Object.freeze({ left: 3, right: 4 })));
describe("sealed", copyPair(Object.seal({ left: 5, right: 6 })));
describe("not extensible", copyPair(Object.preventExtensions({ left: 7, right: 8 })));

const withMore: Pair = { left: 9, right: 10 };
(withMore as Pair & { more: string }).more = "more";
describe("with a property outside its type", copyPair(withMore));
const withSymbol: Pair = { left: 11, right: 12 };
(withSymbol as unknown as Record<symbol, number>)[Symbol.for("mark")] = 1;
describe("with a symbol", copyPair(withSymbol));
const withGetter: Pair = { left: 13, right: 14 };
let reads = 0;
Object.defineProperty(withGetter, "right", { get() { return ++reads; }, enumerable: true, configurable: true });
describe("with a getter", copyPair(withGetter));
describe("with a getter, again", copyPair(withGetter));
const withHidden: Pair = { left: 15, right: 16 };
Object.defineProperty(withHidden, "left", { value: 17, enumerable: false, writable: true, configurable: true });
describe("with a member that is not enumerable", copyPair(withHidden));
const withText: Pair = { left: 18, right: 19 };
(withText as unknown as { left: string }).left = "text";
describe("with a value outside its type", copyPair(withText));
const asPrototype: Pair = { left: 20, right: 21 };
const heir = Object.create(asPrototype) as Pair;
describe("a prototype", copyPair(asPrototype));
describe("its heir", copyPair(heir));
console.log(heir.left, Object.getPrototypeOf(copyPair(asPrototype)) === Object.prototype);

const orders: Optional[] = [{}, { x: 1 }, { y: 2 }, { z: 3, x: 1 }, { y: 2, x: 1, z: 3 }, { z: 3, y: 2, x: 1 }];
for (const optional of orders) describe("optional", copyOptional(optional));
const emptied: Optional = { x: 1, y: 2, z: 3 };
delete emptied.y;
describe("one deleted", copyOptional(emptied));
emptied.y = 4;
describe("and put back", copyOptional(emptied));

const kept: Triple[] = [];
for (let round = 0; round < 20000; round++) kept.push(copyInner(kept.length ? kept[round >> 1] : triple, round));
let sum = 0;
for (const each of kept) sum += each.third!.left + each.third!.right + each.first + each.second.length;
console.log(sum, kept.length);
