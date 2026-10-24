// then, toJSON, Symbol.toPrimitive, Symbol.iterator, Symbol.toStringTag and Symbol.isConcatSpreadable as declared optional fields: names that await, JSON.stringify, conversions, spread and concat look up by themselves.
// With the slot empty the object is ordinary; the first store, by typed code, changes how the language treats it; `delete` changes it back. Then the names arrive on the prototype instead.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Special {
  declare id: number;
  then?: (resolve: (value: string) => void) => void;
  toJSON?: () => unknown;
  [Symbol.toPrimitive]?: (hint: string) => string | number;
  [Symbol.iterator]?: () => Iterator<number>;
  [Symbol.toStringTag]?: string;
  [Symbol.isConcatSpreadable]?: boolean;
  length?: number;
  constructor(id: number) {
    delete this.then;
    delete this.toJSON;
    delete this[Symbol.toPrimitive];
    delete this[Symbol.iterator];
    delete this[Symbol.toStringTag];
    delete this[Symbol.isConcatSpreadable];
    delete this.length;
    handOver(this);
    this.id = id;
  }
}
function arm(special: Special) {
  special.then = resolve => resolve("resolved by then of " + special.id);
  special.toJSON = () => "json of " + special.id;
  special[Symbol.toPrimitive] = hint => (hint === "number" ? special.id * 100 : "primitive " + special.id);
  special[Symbol.iterator] = function* () {
    yield special.id;
    yield special.id + 1;
  };
  special[Symbol.toStringTag] = "Tagged";
}
function disarm(special: Special) {
  delete special.then;
  delete special.toJSON;
  delete special[Symbol.toPrimitive];
  delete special[Symbol.iterator];
  delete special[Symbol.toStringTag];
}
async function treat(special: Special) {
  const awaited: unknown = await (special as unknown);
  let spread: string;
  try {
    spread = [...(special as Iterable<number>)].join();
  } catch (error) {
    spread = (error as Error).constructor.name;
  }
  return [
    awaited === special ? "itself" : awaited,
    JSON.stringify(special),
    JSON.stringify({ inner: special }),
    `${special as unknown as string}`,
    +(special as unknown as number),
    spread,
    Object.prototype.toString.call(special),
    Reflect.ownKeys(special).length,
  ].join(" | ");
}

let length = 0;
for (let i = 0; i < 1000; i++) {
  const special = new Special(i & 7);
  if (i & 1) arm(special);
  length += (await treat(special)).length;
}
console.log("warm", length);

const special = new Special(1);
console.log("empty:", await treat(special));
arm(special);
console.log("armed:", await treat(special));
disarm(special);
console.log("disarmed:", await treat(special));
const list = new Special(2);
console.log("concat:", ([0] as unknown[]).concat(list).length);
list.length = 2;
(list as any)[0] = "a";
(list as any)[1] = "b";
list[Symbol.isConcatSpreadable] = true;
console.log("concat spreads it:", ([0] as unknown[]).concat(list).join());
delete list[Symbol.isConcatSpreadable];
console.log("concat again:", ([0] as unknown[]).concat(list).length);

const holder: any = Object.getPrototypeOf(special);
holder["then"] = function (this: Special, resolve: (value: string) => void) {
  resolve("inherited then for " + this.id);
};
holder["toJSON"] = function (this: Special) {
  return "inherited json for " + this.id;
};
holder[Symbol.toStringTag] = "Inherited";
console.log("on the prototype:", await treat(special), "||", await treat(new Special(3)));
delete holder.then;
delete holder.toJSON;
delete holder[Symbol.toStringTag];
console.log("gone again:", await treat(special));
