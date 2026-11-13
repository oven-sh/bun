// `class Either extends parents[n] {}`: an instance has room for the fields of each parent that its class may have, and one room for a name that both declare.
// One parent lays a number under the name and the other an object, a text or a boolean; under another name one has a field and the other an accessor.
class Node {
  shown = 1.5;
  count = 1;
  flag = true;
  both = "node";
  get late() {
    return "getter of Node";
  }
  sum() {
    return this.shown + this.count;
  }
}
class Leaf {
  shown = { k: "object" };
  count = "text";
  flag = 7;
  late = "field of Leaf";
  get both() {
    return "getter of Leaf";
  }
  set both(value) {
    this.stored = value;
  }
  sum() {
    return this.shown.k + this.count;
  }
}
const pick = process.argv.length > 50 ? 1 : 0;
const parents = [Node, Leaf];
class Either extends parents[pick] {
  extra = 1;
}
class Other extends parents[1 - pick] {
  extra = 2;
}
const below = Base => class extends Base {};
const OverNode = below(parents[pick]);
const OverLeaf = below(parents[1 - pick]);
let text = "";
let total = 0;
const kept = [];
for (let i = 0; i < 20000; i++) {
  const made = [new Either(), new Other(), new OverNode(), new OverLeaf(), new Node(), new Leaf()];
  for (const one of made) {
    const sum = one.sum();
    total += typeof sum === "number" ? sum : sum.length;
    total += typeof one.shown === "number" ? one.shown : one.shown.k.length;
    total += one.late.length + one.both.length + (one.flag === true ? 1 : one.flag);
  }
  made[0].shown = { k: "swapped" };
  made[1].shown = 2.5;
  made[2].count = "now text";
  made[3].count = 4;
  made[1].both = i;
  made[0].both = i;
  if (i % 5000 === 0) kept.push(...made);
}
console.log(total);
for (const one of kept.slice(0, 6))
  console.log(
    one.constructor.name || "(none)",
    JSON.stringify(one),
    Object.keys(one).join(),
    one.late,
    one.both,
    typeof one.shown,
    typeof one.count,
    Object.getOwnPropertyDescriptor(one, "both")?.value,
    Object.getOwnPropertyDescriptor(one, "late")?.value,
  );
