// STATISTIC: MethodCallsDispatchedByShape >= 2
// A method of constructor functions that two of five heirs inherit and the others find above: one arm of the loop takes every layout that finds the same method.
function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
function Contact(next) { this.next = next; this.flags = 0; }
function Circle(next) { Contact.call(this, next); }
function Polygon(next) { Contact.call(this, next); }
function Edge(next) { Contact.call(this, next); }
function Other(next) { Edge.call(this, next); }
Contact.prototype.isTouching = function () { return (this.flags & 2) === 2; };
Contact.prototype.isSensor = function () { return (this.flags & 1) === 1; };
Contact.prototype.weight = function () { return 3; };
inherit(Circle, Contact); inherit(Polygon, Contact); inherit(Edge, Contact); inherit(Other, Edge);
Polygon.prototype.kind = function () { return "polygon"; };
Edge.prototype.weight = function () { return 5; };
Edge.prototype.kind = function () { return "edge"; };
Circle.prototype.kind = function () { return "circle"; };
function make(kind, next) { switch (kind) { case 0: return new Polygon(next); case 1: return new Circle(next); case 2: return new Edge(next); default: return new Other(next); } }
function list(kinds) { let first = null; for (const kind of kinds) first = make(kind, first); return first; }
function count(first) {
  let touching = 0, sensors = 0, weight = 0;
  for (let contact = first; contact; contact = contact.next) {
    if (contact.isTouching()) touching++;
    if (contact.isSensor()) sensors++;
    weight += contact.weight();
    contact.flags = contact.flags + 1 & 3;
  }
  return touching + sensors * 8 + weight * 64;
}
const out = [];
const polygons = list([0, 0, 0, 0]), all = list([0, 1, 2, 3, 2, 1]);
for (let k = 0; k < 4; k++) out.push(count(polygons), count(all));
Circle.prototype.weight = function () { return this.flags + 7; };
for (let k = 0; k < 3; k++) out.push(count(polygons), count(all));
delete Edge.prototype.weight;
for (let k = 0; k < 3; k++) out.push(count(polygons), count(all));
all.weight = () => 1000;
for (let k = 0; k < 2; k++) out.push(count(all));
Object.defineProperty(Contact.prototype, "weight", { get() { return () => 9; }, configurable: true });
for (let k = 0; k < 2; k++) out.push(count(polygons), count(all));
console.log(out.join(" "), polygons.kind());
