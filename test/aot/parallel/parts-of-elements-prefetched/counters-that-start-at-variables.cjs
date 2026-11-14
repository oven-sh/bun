// STATISTIC: ArraysPrefetchedByLoops >= 2
// A loop over a long array prefetches parts of its elements, whatever its counter is held as: it starts at a variable of the file that is stored behind the functions, and at the half of a number.
// A loop over a long array prefetches what the next iterations open: the parts of an element and their parts, by the names that the loop and the methods it calls read. No value depends on it, whatever the elements and their parts are.
class Vector {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
}
class Matrix {
  constructor(seed) { this.elements = [seed, 0, 0, seed + 1, 0, 2, 0, 0, 1]; }
  trace() { const e = this.elements; return e[0] + e[4] + e[8]; }
}
class Bounds {
  constructor(center, radius) { this.center = center; this.radius = radius; }
}
class Item {
  constructor(seed) {
    this.position = new Vector(seed, seed % 7, 1);
    this.scale = new Vector(1, 2, seed % 3);
    this.matrix = new Matrix(seed % 11);
    this.bounds = new Bounds(new Vector(seed % 5, 0, 1), seed % 13);
    this.children = [];
    this.parent = null;
    this.visits = 0;
  }
  add(child) { child.parent = this; this.children.push(child); return this; }
  update(force) {
    this.visits++;
    let sum = this.position.length() + this.scale.length() + this.matrix.trace() + this.bounds.radius + this.bounds.center.x;
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) sum += children[i].update(force);
    return sum;
  }
}
class Marked extends Item {
  constructor(seed) { super(seed); this.mark = { name: "m" + seed }; }
  update(force) { return super.update(force) + this.mark.name.length; }
}
globalThis.KEPT = [Vector, Matrix, Bounds, Item, Marked];
class Root {
  constructor() { this.children = []; }
  updateAll(force) {
    const children = this.children;
    let sum = 0, failed = 0;
    for (let i = 0, l = children.length; i < l; i++) {
      const child = children[i];
      try { sum += child.update(force); } catch (e) { failed++; }
    }
    return Math.round(sum * 8) + ":" + failed;
  }
  sumOf(list) {
    let sum = 0;
    for (let i = FIRST; i < list.length; i++) sum += measure(list[i], i);
    return Math.round(sum * 8);
  }
  sumOfSome(list) {
    let sum = 0;
    for (let i = FIRST; i < list.length; i += STEP) { sum += measure(list[i], i); this.last = i; }
    return Math.round(sum * 8);
  }
  sumBehind(list, first) {
    let sum = 0;
    for (let i = first * 0.5; i < list.length; i++) sum += measure(list[i], i);
    return Math.round(sum * 8);
  }
}
function measure(item, place) {
  const bounds = item.bounds;
  return bounds.center.length() + bounds.radius + item.matrix.elements[place % 9] + item.position.x + (item.children.length ? measure(item.children[0], place) : 0);
}
globalThis.roots = [];
const root = new Root(), other = new Root();
globalThis.roots.push(root, other);
for (let i = 0; i < 6000; i++) {
  const item = i % 10 ? new Item(i) : new Marked(i);
  for (let k = 0; k < i % 3; k++) item.add(new Item(i + k));
  root.children.push(item);
}
var FIRST = 2, STEP = 2;
console.log(root.sumOf(root.children), root.sumOfSome(root.children), root.last, root.sumBehind(root.children, 8));
console.log(other.sumOf(root.children.slice(0, 1500)), other.sumOfSome(root.children.slice(0, 1500)), other.last, other.sumBehind(root.children.slice(0, 1500), 2));
console.log(root.updateAll(1));
FIRST = 1;
console.log(root.sumOf(root.children), root.sumOfSome([]), root.last);
