// `Object.values(o)[1]` and `Object.keys(o)[0]` behind the tests of the key order make no list, and `{ ...o }` in a loop copies the words of the cell.
// Each row below breaks one thing that the tests stand for: what is read or copied must be what plain Bun reads or copies.
// STATISTIC: OwnKeyWalksExpanded >= 1
type Parcel = { weight: number; fragile?: number; insured?: number };

function second(parcel: Parcel) {
  return Object.values(parcel)[1];
}
function firstName(parcel: Parcel) {
  return Object.keys(parcel)[0];
}
function eighth(parcel: Parcel) {
  return Object.values(parcel)[7];
}
function read(parcels: Parcel[], turns: number) {
  let said = "";
  for (let at = 0; at < turns; at++) {
    const parcel = parcels[at % parcels.length];
    said += `${second(parcel)},${firstName(parcel)},${eighth(parcel)} `;
  }
  return said;
}
function copies(parcels: Parcel[], turns: number) {
  const made: Parcel[] = [];
  for (let at = 0; at < turns; at++) {
    const one = { ...parcels[at % parcels.length] };
    made.push(one);
  }
  return made;
}
function describe(parcels: Parcel[]) {
  return parcels
    .map(parcel => `${JSON.stringify(parcel)}${Object.isFrozen(parcel) ? " frozen" : ""}${Object.getOwnPropertySymbols(parcel).length ? " with a symbol" : ""}${Object.getPrototypeOf(parcel) === Object.prototype ? "" : " below another object"}`)
    .join(" ");
}
function both(name: string, parcels: Parcel[]) {
  console.log(name, "|", read(parcels, parcels.length + 1), "|", describe(copies(parcels, parcels.length + 1)));
}

both("as made", [{ weight: 1, fragile: 2 }, { weight: 3, insured: 4 }, { weight: 5 }, { weight: 6, fragile: 7, insured: 8 }]);
both("another order", [{ insured: 1, weight: 2 }, { fragile: 3, insured: 4, weight: 5 }]);

const grown: Parcel = { weight: 1 };
grown.insured = 2;
grown.fragile = 3;
both("grown later", [grown]);

const withMore: Parcel = { weight: 1, fragile: 2 };
(withMore as any).stamp = 3;
both("a name that the type lacks", [withMore, { weight: 1, fragile: 2 }]);

const withIndex: Parcel = { weight: 1, fragile: 2 };
(withIndex as any)[0] = 3;
both("an index", [withIndex]);

const withSymbol: Parcel = { weight: 1, fragile: 2 };
(withSymbol as any)[Symbol("seal")] = 3;
both("a symbol", [withSymbol]);

const shrunk: Parcel = { weight: 1, fragile: 2 };
delete shrunk.fragile;
both("a field deleted", [shrunk]);

const deletedAndBack: Parcel = { weight: 1, fragile: 2, insured: 3 };
delete deletedAndBack.fragile;
deletedAndBack.fragile = 4;
both("deleted and laid again", [deletedAndBack]);

const hidden: Parcel = { weight: 1, fragile: 2 };
Object.defineProperty(hidden, "fragile", { enumerable: false });
both("a field hidden", [hidden]);

let asked = 0;
const computed: Parcel = { weight: 1, fragile: 2 };
Object.defineProperty(computed, "fragile", { get() { return ++asked; }, enumerable: true, configurable: true });
both("a getter in place of a field", [computed]);
console.log("the getter was asked", asked, "times");

both("a field that holds undefined", [{ weight: 1, fragile: undefined }]);
both("frozen", [Object.freeze({ weight: 1, insured: 2 })]);
both("sealed", [Object.seal({ weight: 1, insured: 2 })]);
both("fields of the object above", [Object.create({ weight: 1, fragile: 2 })]);
both("a proxy", [new Proxy({ weight: 1, fragile: 2 }, { ownKeys() { return ["weight"]; }, getOwnPropertyDescriptor() { return { value: 9, enumerable: true, configurable: true }; }, get() { return 9; } })]);
both("a list", [[7, 8, 9] as unknown as Parcel]);
both("a text", ["four" as unknown as Parcel]);
both("parsed", JSON.parse('[{"weight":1,"fragile":2},{"insured":1,"weight":2,"more":3}]'));

console.log("nothing is spread |", describe(copies([undefined as unknown as Parcel, null as unknown as Parcel, 5 as unknown as Parcel], 3)));
for (const nothing of [undefined, null]) {
  try {
    console.log(read([{ weight: 1 }, nothing as unknown as Parcel], 2));
  } catch (error) {
    console.log("nothing:", (error as Error).constructor.name);
  }
}

const source: Parcel = { weight: 1, fragile: 2 };
const [copied] = copies([source], 1);
copied.weight = 9;
copied.insured = 8;
console.log("the copy is its own object |", JSON.stringify(source), JSON.stringify(copied), Object.keys(copied).join());
