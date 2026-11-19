// Methods and functions of a base store names late into objects of the base and of heirs at three levels, with fields of their own of every width.
const out = [];
let hash = 0;
function take(value) {
  const text = value === undefined ? "u" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "o" + Object.keys(value) : typeof value === "function" ? "f" : String(value);
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
}
class Node0 {
  kind = 1;
  fill(x) {
    this.count = x;
    if (x & 1) this.name = "n" + x;
    this.ratio = x / 3;
    if (x & 2) this.next = x & 4 ? this : null;
    this.done = x % 3 === 0;
    return this;
  }
  sum() {
    return (this.count ?? 0) + (this.ratio ?? 0) + (this.done ? 1 : 0) + (this.name ?? "").length;
  }
}
class Node1 extends Node0 {
  flag = true;
  text = "t";
  fill(x) {
    super.fill(x);
    this.later = [x];
    return this;
  }
}
class Node2 extends Node1 {
  ratio = -1.5;
  wide = 2 ** 40;
  small = 3;
  list() {
    this.count = this.small + this.wide;
    return this;
  }
}
class Node3 extends Node2 {
  name = "own";
  on = false;
}
function Old() {
  this.a = 1;
}
Old.prototype.lay = function (x) {
  this.b = x;
  this.c = x > 2;
  if (x & 1) this.d = "d" + x;
  return this;
};
function Heir() {
  Old.call(this);
  this.e = 0.5;
  this.f = "f";
}
Object.setPrototypeOf(Heir.prototype, Old.prototype);
function Last() {
  Heir.call(this);
  this.c = "c";
  this.g = null;
}
Last.prototype = Object.create(Heir.prototype);
function listed(object) {
  take(Object.keys(object).join());
  take(JSON.stringify(object, (key, value) => (key === "next" ? null : value)));
  take(Object.entries({ ...object }).length);
}
function read(object) {
  take(object.count); take(object.name); take(object.ratio); take(object.next); take(object.done); take(object.later); take(object.flag); take(object.small); take("ratio" in object); take(Object.hasOwn(object, "name"));
}
function readOld(object) {
  take(object.a); take(object.b); take(object.c); take(object.d); take(object.e); take(object.f); take(object.g);
}
for (let x = 0; x < 400; x++) {
  for (const Class of [Node0, Node1, Node2, Node3]) {
    const object = new Class();
    read(object);
    if (x & 8 && object.list) object.list();
    try { object.fill(x); } catch (error) { take(error.name); }
    read(object);
    take(object.sum());
    listed(object);
    if (x % 5 === 0) delete object.name;
    if (x % 7 === 0) Object.freeze(object);
    try { object.fill(x + 1); } catch (error) { take(error.name); }
    read(object);
    listed(object);
  }
  for (const Class of [Old, Heir, Last]) {
    const object = new Class();
    readOld(object);
    object.lay(x);
    readOld(object);
    listed(object);
    if (x % 3 === 0) Object.defineProperty(object, "b", { value: x, writable: false });
    object.lay(x + 1);
    readOld(object);
  }
  if (x === 300) Object.defineProperty(Old.prototype, "d", { set(value) { take("set" + value); }, get() { return "got"; }, configurable: true });
  if (x === 350) Object.defineProperty(Node0.prototype, "next", { value: "above", writable: false, configurable: true });
  if (x % 50 === 0) out.push(hash);
}
console.log(out.join(), hash);
