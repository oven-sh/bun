// Two objects are created below one value: Object.create(x) throws at the first for an x that is no object, and nothing behind it runs.
const log = [];
function pair(above) {
  const first = Object.create(above);
  const second = Object.create(above);
  log.push("made");
  first.side = "left";
  second.side = "right";
  return [first, second];
}
const [left, right] = pair({ kind: "above" });
console.log(left.side, right.side, left.kind, right.kind, log.length);
for (const refused of [1, "text", undefined, true, 5n, Symbol("s")]) {
  try {
    pair(refused);
    console.log("no throw");
  } catch (e) {
    console.log(e.constructor.name, e.message, log.length);
  }
}
const [bare] = pair(null);
console.log(Object.getPrototypeOf(bare), bare.side, log.length);
