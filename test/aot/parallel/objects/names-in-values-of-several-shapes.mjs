// "name" in value over objects of several literals and classes, while somebody adds the name, deletes it or lays it above.
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
class Leaf { constructor(v) { this.v = v; } }
class Pair extends Leaf { constructor(v, w) { super(v); this.w = w; } }
class Other { constructor(z) { this.z = z; } get late() { return this.z + 1; } }
function makeAll() {
  return [{ v: 1 }, { w: 2 }, { v: 4, w: 3 }, { z: 1 }, new Leaf(5), new Pair(6, 7), new Other(8)];
}
function readAll(x) {
  let sum = 0;
  if ("v" in x) sum += x.v;
  if ("w" in x) sum += x.w * 2;
  else if ("z" in x) sum -= x.z;
  if (!("late" in x)) sum += 1000;
  else sum += x.late;
  return sum;
}
function kindOf(node) {
  if ("expression" in node) return node.expression.length;
  if ("left" in node && "right" in node) return kindOf(node.left) + kindOf(node.right);
  return node.value;
}
function askNothing(list, i) {
  const x = list[i % list.length];
  return "v" in x ? x.v : -1;
}
function run(change, at) {
  const all = makeAll();
  let text = "";
  for (let i = 0; i < 60; i++) {
    if (i === at) change(all);
    text += attempt(() => readAll(all[i % all.length])) + " ";
  }
  return text;
}
const changes = [
  () => {},
  all => { all[0].w = 11; },
  all => { delete all[2].v; },
  all => { delete all[4].v; delete all[5].w; },
  all => { Pair.prototype.late = 50; },
  all => { delete Pair.prototype.late; },
  all => { Leaf.prototype.z = 9; },
  all => { delete Leaf.prototype.z; },
  all => { Object.setPrototypeOf(all[1], { v: 30 }); },
  all => { Object.freeze(all[0]); Object.defineProperty(all[3], "v", { get() { return this.z * 100; }, configurable: true }); },
  all => { all[6] = new Proxy(all[6], { has(target, key) { return key === "w" || key in target; } }); },
  all => { all[2] = JSON.parse('{"v":70,"late":2}'); },
  all => { all[1] = undefined; all[3] = null; },
  all => { all[5] = 7; all[6] = "text"; },
];
for (const change of changes) for (const at of [0, 7, 33, 59]) console.log(run(change, at));
const tree = { left: { value: 1 }, right: { left: { expression: "abc" }, right: { value: 4 } } };
let sum = 0;
for (let i = 0; i < 100; i++) sum += kindOf(tree);
console.log(sum);
const some = [{ v: 1 }, { w: 2 }, undefined, { v: 3 }];
let nothing = "";
for (let i = 0; i < 12; i++) nothing += attempt(() => askNothing(some, i)) + " ";
console.log(nothing);
tree.right.right.expression = "later";
console.log(kindOf(tree));
console.log(attempt(() => kindOf(Object.create(tree))), attempt(() => kindOf(Object.create({ left: { value: 9 }, right: { value: 8 } }))));
