class Counted extends Map {
  constructor(pairs) { super(pairs); this.asked = 0; }
  values() { this.asked++; return super.values(); }
}
class Plain extends Map {}
function listOf(steps) {
  const list = [];
  for (const step of steps) list.push(step);
  return list;
}
function run(turn) {
  const counted = new Counted([["a", turn], ["b", 2]]);
  const plain = new Plain([["p", turn]]);
  return [listOf(counted.values()).join(), counted.asked, listOf(counted.keys()).join(), listOf(plain.values()).join(), listOf(Map.prototype.values.call(counted)).join(), counted.asked].join(" ");
}
globalThis.kept = listOf;
console.log(run(1));
console.log(run(2));
