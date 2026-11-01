// Objects of built-in classes, and of classes below them, are handed to a function nobody knows and are then converted to strings and written out as JSON: each still finds what stands above it.
const hook = globalThis[process.argv[9] ?? "noSuchHook"];
const kept = [];
function hand(value) {
  hook?.(value);
  kept.push(value);
  return value;
}
class List extends Array {
  constructor() {
    super();
    this.tag = 1;
  }
}
class Failure extends Error {
  get name() {
    return "Failure";
  }
}
const list = hand(new List());
list.push(1, "two", [3, 4], null);
const values = [
  list,
  hand(new Error("lost")),
  hand(new Failure("mine")),
  hand(new Map([[1, 2]])),
  hand(new Set([1])),
  hand(/a+b/giu),
  hand(new Date(0)),
  hand(Promise.resolve(1)),
  hand([1, [2, [3]]]),
  hand({ held: 1 }),
  hand(new Uint8Array([1, 2])),
  hand(function named() {}),
];
for (const value of values) {
  console.log(`${value}`.replace(/\(.*\)/, ""));
  console.log(JSON.stringify(value));
  console.log(Object.prototype.toString.call(value));
}
list.join = function () {
  return "joined by the program";
};
console.log(`${list}`, JSON.stringify({ list }));
Object.defineProperty(kept[2], "message", { get: () => "read late" });
console.log(`${kept[2]}`);
kept[9][Symbol.toPrimitive] = () => "converted";
console.log(`${kept[9]}`, kept.length);
