// An object constructed for another class is used like any object.
class Wide {
  constructor(seed) {
    this.first = seed;
    this.second = seed + 0.5;
    this.third = "text " + seed;
    this.fourth = [seed, seed];
    this.fifth = { inner: seed };
    this.sixth = seed * 1000003;
    this.seventh = null;
    this.eighth = true;
    this.ninth = -seed;
    this.tenth = seed / 3;
    this.eleventh = "more " + seed;
    this.twelfth = [seed];
  }
}

class Other {
  label() {
    return "other";
  }
}

function summarize(made) {
  let text = "";
  for (const key of Object.keys(made)) text += key + "=" + JSON.stringify(made[key]) + " ";
  return text;
}

const kept = [];
for (let round = 0; round < 200; round++) {
  const made = Reflect.construct(Wide, [round], Other);
  for (let i = 0; i < 40; i++) made["added" + i] = round + i;
  made[round] = "element " + round;
  kept.push(made);
}

let total = 0;
for (const made of kept) {
  for (let i = 0; i < 40; i++) total += made["added" + i];
}
console.log("sum of what was added:", total);
console.log("the first:", summarize(kept[0]));
console.log("the last:", summarize(kept[199]));
console.log("label:", kept[7].label(), kept[7] instanceof Other, kept[7] instanceof Wide);

for (const made of kept) {
  delete made.added3;
  made.first = "stored later";
  Object.defineProperty(made, "second", { value: 1, enumerable: false, configurable: true });
}
console.log("after more changes:", summarize(kept[100]));
console.log("copied:", summarize({ ...kept[50] }));
console.log("as JSON:", JSON.stringify(kept[150]).length);

const honest = new Wide(3);
console.log("honest:", summarize(honest));
