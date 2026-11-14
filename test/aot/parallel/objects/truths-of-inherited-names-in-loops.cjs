// The truth of names that objects inherit from a plain object, or lack, asked in loops over a list that nobody knows.
const list = JSON.parse("[0]").slice(1);
const parent = { visible: 1, hidden: 0, label: "", title: "a" };
function Node(id) {
  this.id = id;
}
Node.prototype = parent;
function Leaf(id) {
  this.id = id;
  this.leaf = true;
}
Leaf.prototype = Object.create(parent);
function fill(make, n) {
  list.length = 0;
  for (let i = 0; i < n; i++) list.push(make(i));
}
function visible(l) {
  let c = 0;
  for (let i = 0; i < l.length; i++) if (l[i].visible) c++;
  return c;
}
function hidden(l) {
  let c = 0;
  for (const o of l) if (o.hidden) c++;
  return c;
}
function label(l) {
  let c = 0;
  for (let i = 0; i < l.length; i++) c += l[i].label ? 2 : 1;
  return c;
}
function title(l) {
  let c = 0;
  for (let i = 0; i < l.length; i++) if (!l[i].title) c++;
  return c;
}
function absent(l) {
  let c = 0;
  for (let i = 0; i < l.length; i++) if (l[i].absent) c++;
  return c;
}
function both(l) {
  let c = 0;
  for (let i = 0; i < l.length; i++) {
    const o = l[i];
    if (o.visible && !o.absent) c++;
  }
  return c;
}
const lines = [];
function round(name) {
  for (let i = 0; i < 3; i++) lines.push([name, visible(list), hidden(list), label(list), title(list), absent(list), both(list)].join(" "));
}
fill(i => new Node(i), 50);
round("nodes");
parent.visible = 0;
parent.hidden = "x";
round("changed");
parent.absent = {};
round("added");
delete parent.absent;
round("deleted");
fill(i => new Leaf(i), 50);
round("leaves");
parent.visible = true;
round("changed");
Leaf.prototype.visible = null;
round("shadowed");
delete Leaf.prototype.visible;
round("unshadowed");
fill(i => (i & 1 ? new Node(i) : new Leaf(i)), 50);
round("both");
Object.defineProperty(parent, "absent", { get() { return this.id % 3; }, configurable: true });
round("getter");
delete parent.absent;
list[7].absent = 1;
list[8].visible = 0;
round("own");
Object.setPrototypeOf(list[9], { visible: 0, absent: 1 });
round("other parent");
Object.setPrototypeOf(parent, { absent: 5 });
round("grandparent");
console.log(lines.join("\n"));
