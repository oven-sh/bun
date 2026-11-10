// Nine hundred parcels, each with one name of its own beside the names they share. The rest of a pattern is taken of each one once:
// no two copies have the same source, so a plan made for one serves nobody. Only what is copied a second time gets a plan.
// (The bound leaves room for parcels that fall on one place of the table of copies remembered: about fifty of nine hundred.)
// COUNTER: AssignmentPlansMade <= 150
// COUNTER: PropertyListsMade <= 250
const parcels = [];
for (let i = 0; i < 900; i++) {
  const parcel = { id: i, label: "p" + i };
  parcel["mark" + i] = i * 3;
  parcels.push(parcel);
}
let kept;
function unpack(from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const { id, ...others } = parcels[i];
    kept = others;
    sum += id & 3;
  }
  return sum;
}
let sum = 0;
for (let from = 0; from < 900; from += 60) {
  sum += unpack(from, from + 60);
  sum += Object.keys(kept).length + ("id" in kept ? 100 : 0) + kept["mark" + (from + 59)];
}
console.log(sum, JSON.stringify(kept), Object.keys(parcels[899]).join());
