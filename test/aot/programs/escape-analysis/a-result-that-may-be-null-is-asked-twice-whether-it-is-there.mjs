// A function returns null, undefined or a new object. Its caller asks twice whether the result is there, hands it to Object.hasOwn, then reads a property.
const lines = [];
function note(...values) {
  for (let index = 0; index < values.length; index++) lines.push(String(values[index]));
}

let cleanups = 0;
function makePairOrNull(a, b) {
  try {
    return a % 3 === 0 ? null : { a, b };
  } finally {
    cleanups++;
  }
}
function makePairOrNothing(a, b) {
  return a % 3 === 0 ? null : a % 3 === 1 ? undefined : { a, b };
}

class Holder {
  seed;
  constructor(seed) {
    this.seed = seed;
  }
  askPairOrNull() {
    const seed = this.seed;
    for (let turn = 0; turn < 3; turn++) {
      const pair = makePairOrNull(turn, seed);
      note(pair ? "a" in pair : "none", pair ? Object.hasOwn(pair, "b") : "none", pair?.b);
    }
  }
  askPairOrNothing() {
    const seed = this.seed;
    for (let turn = 0; turn < 6; turn++) {
      const pair = makePairOrNothing(turn, seed);
      note(pair ? "a" in pair : "none", pair ? Object.hasOwn(pair, "b") : "none", pair?.b);
    }
  }
}

for (const seed of [1, 2]) {
  new Holder(seed).askPairOrNull();
  console.log("pair or null:", lines.join(","));
  lines.length = 0;
  new Holder(seed).askPairOrNothing();
  console.log("pair or nothing:", lines.join(","));
  lines.length = 0;
}
console.log("cleanups:", cleanups);
