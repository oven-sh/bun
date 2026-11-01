// Array.from over a Set, a Map, an iterator or a string with a mapper: calls, this, closing and errors.
class Bag {
  constructor() {
    this.made = true;
  }
  set 0(value) {
    console.log("setter must not run", value);
  }
}
const set = new Set([1, 2, 3]);
const map = new Map([
  ["a", 1],
  ["b", 2],
]);
const seen = [];
console.log(Array.from(set, (v, k) => v * 2 + k));
console.log(
  Array.from(
    set,
    function (v) {
      return this.base + v;
    },
    { base: 10 },
  ),
);
console.log(Array.from(map, ([k, v]) => k + v));
console.log(Array.from("héllo", c => c.toUpperCase()));
console.log(Array.from(set.values(), v => v + 1));
console.log(Array.from(map.keys(), v => v + "!"));
console.log(Array.from(new Set(), v => v));
const bag = Array.from.call(Bag, set, v => v);
console.log(bag instanceof Bag, bag.made, bag.length, Object.keys(bag));
console.log(
  Array.from.call(
    () => 0,
    set,
    v => v,
  ),
);
console.log(Array.from.call(undefined, set, v => v));
try {
  Array.from.call(
    function () {
      return 1;
    },
    set,
    v => v,
  );
  console.log("a primitive from new is replaced by the object");
} catch (e) {
  console.log(e.message);
}
const growing = new Set([1]);
console.log(
  Array.from(growing, v => {
    if (v < 4) growing.add(v + 1);
    return v;
  }),
);
const shrinking = new Set([1, 2, 3, 4]);
console.log(
  Array.from(shrinking, v => {
    shrinking.delete(v + 1);
    return v;
  }),
);
try {
  Array.from(set, v => {
    seen.push(v);
    throw new Error("from the mapper " + v);
  });
} catch (e) {
  console.log(e.message, seen);
  console.log(
    e.stack
      .split("\n")
      .slice(0, 4)
      .map(line => line.replace(/[^ (]*[\\/]/, ""))
      .join("|"),
  );
}
try {
  Array.from(set, 1);
} catch (e) {
  console.log(e.name, e.message);
}
let turns = 0;
for (let i = 0; i < 1000; i++) turns += Array.from(set, v => v + i).length;
console.log(turns);
