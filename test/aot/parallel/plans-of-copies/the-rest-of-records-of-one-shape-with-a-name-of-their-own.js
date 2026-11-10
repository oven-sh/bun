// The same parcels, all with the same late name: the first copy goes without a plan, the second makes it, every later one goes by it.
// COUNTER: AssignmentPlansMade >= 1
// COUNTER: AssignmentPlansMade <= 40
// COUNTER: CopiesCollectedByName <= 40
// COUNTER: PropertyListsMade >= 1
const parcels = [];
for (let i = 0; i < 900; i++) {
  const parcel = { id: i, label: "p" + i };
  parcel["mark"] = i * 3;
  parcels.push(parcel);
}
let kept;
function unpack(list, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const { id, ...others } = list[i];
    kept = others;
    sum += id & 3;
  }
  return sum;
}
let sum = 0;
for (let from = 0; from < 900; from += 60) {
  sum += unpack(parcels, from, from + 60);
  sum += Object.keys(kept).length + ("id" in kept ? 100 : 0) + kept.mark;
}
const odd = [Object.freeze({ id: 1, label: "frozen", mark: 2 }), Object.defineProperty({ id: 2, label: "hidden" }, "mark", { value: 3, enumerable: false }), { id: 3, get label() { return "got"; }, mark: 4 }, Object.assign(Object.create({ inherited: 1 }), { id: 4, label: "heir", mark: 5 }), { id: 5, [Symbol.for("s")]: 6, label: "symbol", mark: 7 }, { 7: "seven", id: 6, label: "index", mark: 8 }];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < odd.length; i++) {
    const n = unpack(odd, i, i + 1);
    console.log(round, n, JSON.stringify(kept), Reflect.ownKeys(kept).map(String).join(), Object.isFrozen(kept));
  }
}
console.log(sum, JSON.stringify(kept));
