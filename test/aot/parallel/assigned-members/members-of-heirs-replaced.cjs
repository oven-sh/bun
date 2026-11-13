// Methods that capture a variable, assigned to the prototype of a constructor function, called on objects of any of its heirs, before and after a heir replaces one.
var space = {};
(function (space) {
  space.inherit = function (heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; };
  function Contact(next) { this.next = next; this.flags = 0; }
  function Circle(next) { Contact.call(this, next); }
  function Polygon(next) { Contact.call(this, next); }
  function Edge(next) { Contact.call(this, next); }
  function Other(next) { Contact.call(this, next); }
  space.Contact = Contact; space.Circle = Circle; space.Polygon = Polygon; space.Edge = Edge; space.Other = Other;
})(space);
(function () {
  var A = space.Contact; A.touching = 2; A.sensor = 1;
  A.prototype.isTouching = function () { return (this.flags & A.touching) === A.touching; };
  A.prototype.isSensor = function () { return (this.flags & A.sensor) === A.sensor; };
  A.prototype.weight = function () { return A.sensor + 2; };
  var b = space.Circle, c = space.Polygon, d = space.Edge, e = space.Other;
  space.inherit(b, space.Contact); space.inherit(c, space.Contact); space.inherit(d, space.Contact); space.inherit(e, space.Contact);
  c.prototype.kind = function () { return "polygon"; };
})();
function makePolygon(next) { return new space.Polygon(next); }
function makeCircle(next) { return new space.Circle(next); }
function makeEdge(next) { return new space.Edge(next); }
function makeOther(next) { return new space.Other(next); }
const registers = [];
function register(kind, create) { registers[kind] = { create: create, primary: true }; }
register(0, makePolygon); register(1, makeCircle); register(2, makeEdge); register(3, makeOther);
function make(kind, next) { const entry = registers[kind]; return entry.create(next); }
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
const polygons = list([0, 0, 0, 0]);
for (let k = 0; k < 5; k++) out.push(count(polygons));
space.Circle.prototype.isTouching = function () { return (this.flags & 1) === 1; };
for (let k = 0; k < 2; k++) out.push(count(polygons));
const all = list([0, 1, 2, 3]);
for (let k = 0; k < 5; k++) out.push(count(all));
space.Edge.prototype.weight = function () { return 50; };
for (let k = 0; k < 3; k++) out.push(count(all), count(polygons));
Bun.gc(true);
delete space.Edge.prototype.weight;
for (let k = 0; k < 3; k++) out.push(count(all), count(polygons));
space.Contact.prototype.isSensor = function () { return true; };
for (let k = 0; k < 3; k++) out.push(count(all), count(polygons));
delete space.Contact.prototype.isSensor;
try { count(polygons); } catch (e) { out.push(e.name); }
console.log(out.join(" "), polygons.kind());
