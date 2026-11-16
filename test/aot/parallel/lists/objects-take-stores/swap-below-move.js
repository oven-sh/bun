
class Below extends Array {}
function contents() {
  const boxes = n => Array.from({ length: n }, (_, i) => ({ v: (i * 37) % 11, s: i }));
  const holes = boxes(9); delete holes[3]; delete holes[7];
  const named = boxes(7); named.note = "x"; named["-1"] = { v: 99, s: 98 };
  const accessor = boxes(6); Object.defineProperty(accessor, 2, { get() { return { v: 5, s: 50 }; }, set(x) { log.push("set " + (x && x.v)); }, configurable: true, enumerable: true });
  const sparse = boxes(4); sparse[5000] = { v: 1, s: 77 };
  const mixed = [{ v: 3, s: 0 }, null, { v: 1, s: 2 }, undefined, { v: 2, s: 4 }];
  return { boxes: boxes(12), one: boxes(1), none: [], holes, named, accessor, sparse, mixed, frozen: Object.freeze(boxes(5)), sealed: Object.seal(boxes(5)), below: Below.from(boxes(8)), strings: ["b", "a", "d", "c"], numbers: [5, 3, 9, 1], doubles: [5.5, 3.25, -0, 1], two: [boxes(3), boxes(2)] };
}
const log = [];
function show(x) { return x === null || typeof x !== "object" ? (Object.is(x, -0) ? "-0" : String(x)) : Array.isArray(x) ? "[" + x.length + "]" : x.v + ":" + x.s; }
function tell(list) { let s = list.length + " "; for (let i = -1; i < Math.min(list.length, 14); i++) s += (i in list ? show(list[i]) : "_") + ","; return s; }

function less(a, b) { return a && b && a.v < b.v; }
function walk(list) {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i - 1]) list[i] = list[i - 1];
  }
  return n;
}
for (let round = 0; round < 2; round++) for (const [name, list] of Object.entries(contents())) {
  let said;
  try { said = walk(list); } catch (e) { said = (e).constructor.name; }
  console.log(name, said, tell(list), log.splice(0).join(" "));
}
