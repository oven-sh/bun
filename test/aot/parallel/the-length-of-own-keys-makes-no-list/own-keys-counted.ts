// `Object.keys(o).length` and `Object.values(o).length` behind the tests of the key order make no list. Each row below breaks one thing that the tests stand for:
// the count must be what plain Bun counts.
// STATISTIC: OwnKeyWalksExpanded >= 1
type Parcel = { weight: number; fragile?: number; insured?: number };

function marks(parcel: Parcel) {
  return Object.keys(parcel).length;
}
function worths(parcel: Parcel) {
  return Object.values(parcel).length;
}
function count(parcels: Parcel[], turns: number) {
  let keys = 0;
  let values = 0;
  for (let at = 0; at < turns; at++) {
    keys += marks(parcels[at % parcels.length]);
    values += worths(parcels[at % parcels.length]);
  }
  return `${keys} ${values}`;
}

const asMade: Parcel[] = [{ weight: 1, fragile: 2 }, { weight: 3, insured: 4 }, { weight: 5 }, { weight: 6, fragile: 7, insured: 8 }];
console.log("as made", count(asMade, 9));

const otherOrder: Parcel[] = [{ insured: 1, weight: 2 }, { fragile: 3, insured: 4, weight: 5 }];
console.log("another order", count(otherOrder, 9));

const grown: Parcel = { weight: 1 };
grown.insured = 2;
grown.fragile = 3;
console.log("grown later", count([grown], 3));

const withMore: Parcel = { weight: 1, fragile: 2 };
(withMore as any).stamp = 3;
console.log("a name that the type lacks", count([withMore, { weight: 1, fragile: 2 }], 4));

const withIndex: Parcel = { weight: 1, fragile: 2 };
(withIndex as any)[0] = 3;
console.log("an index", count([withIndex], 3));

const withSymbol: Parcel = { weight: 1, fragile: 2 };
(withSymbol as any)[Symbol("seal")] = 3;
console.log("a symbol", count([withSymbol], 3));

const shrunk: Parcel = { weight: 1, fragile: 2 };
delete shrunk.fragile;
console.log("a field deleted", count([shrunk], 3));

const deletedAndBack: Parcel = { weight: 1, fragile: 2, insured: 3 };
delete deletedAndBack.fragile;
deletedAndBack.fragile = 4;
console.log("deleted and laid again", count([deletedAndBack], 3), Object.keys(deletedAndBack).join());

const hidden: Parcel = { weight: 1, fragile: 2 };
Object.defineProperty(hidden, "fragile", { enumerable: false });
console.log("a field hidden", count([hidden], 3));

const computed: Parcel = { weight: 1, fragile: 2 };
Object.defineProperty(computed, "fragile", { get() { return 9; }, enumerable: true, configurable: true });
console.log("a getter in place of a field", count([computed], 3));

const holdsUndefined: Parcel = { weight: 1, fragile: undefined };
console.log("a field that holds undefined", count([holdsUndefined], 3));

const frozen: Parcel = Object.freeze({ weight: 1, insured: 2 });
console.log("frozen", count([frozen], 3));

const below: Parcel = Object.create({ weight: 1, fragile: 2 });
console.log("fields of the object above", count([below], 3));

const watched: Parcel = new Proxy({ weight: 1, fragile: 2 }, { ownKeys() { return ["weight"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } });
console.log("a proxy", count([watched], 3));

console.log("a list", count([[7, 8, 9] as unknown as Parcel], 3));
console.log("a text", count(["four" as unknown as Parcel], 3));
console.log("a number", count([5 as unknown as Parcel], 3));
console.log("parsed", count(JSON.parse('[{"weight":1,"fragile":2},{"insured":1,"weight":2,"more":3}]'), 4));

for (const nothing of [undefined, null]) {
  try {
    console.log(count([{ weight: 1 }, nothing as unknown as Parcel], 4));
  } catch (error) {
    console.log("nothing:", (error as Error).constructor.name);
  }
}

function changedInTurns(turns: number) {
  const parcel: Parcel = { weight: 1 };
  let said = "";
  for (let at = 0; at < turns; at++) {
    said += marks(parcel);
    if (at === 1) parcel.fragile = 2;
    if (at === 3) parcel.insured = 3;
    if (at === 5) delete (parcel as any).weight;
  }
  return said;
}
console.log("changed between the turns", changedInTurns(8));

function grownList(parcel: Parcel) {
  const names = Object.keys(parcel);
  names.push("more");
  return names.length;
}
function handedOn(parcel: Parcel) {
  return Object.keys(parcel);
}
function asCondition(parcel: Parcel) {
  return Object.keys(parcel).length ? "some" : "none";
}
function lists(turns: number) {
  let said = "";
  for (let at = 0; at < turns; at++) said += `${grownList(asMade[at & 3])}${handedOn(asMade[at & 3]).join("")}${asCondition(asMade[at & 3])} `;
  return said;
}
console.log("lists that something else reads", lists(4));
