// STATISTIC: PrototypesLaidByHelpers >= 3
// A helper makes the prototype of each kind of shape with a map of descriptors; the kind takes what its parent holds besides: what the map says of writing, listing and taking away is what the prototype does.
"use strict";
function layBelow(kind, above) {
  kind.prototype = Object.create(above.prototype, { above: { value: above, enumerable: false }, constructor: { value: kind, writable: true, configurable: true } });
}
function Shape(name) { this.name = name; this.parts = 0; }
Shape.prototype.grow = function (n) { this.parts += n; return this; };
Shape.prototype.told = function () { return this.name + ":" + this.parts; };
Shape.known = [];
Shape.note = function (shape) { this.known.push(shape.name); return shape; };
function Ring(name, width) { Shape.call(this, name); this.width = width; }
layBelow(Ring, Shape);
Ring.prototype.told = function () { return Shape.prototype.told.call(this) + "/" + this.width; };
function Chain(name, width, links) { Ring.call(this, name, width); this.links = links; }
layBelow(Chain, Ring);
Chain.prototype.grow = function (n) { this.links++; return Ring.prototype.grow.call(this, n * 2); };
function Cord(name) { Shape.call(this, name); this.bent = false; }
layBelow(Cord, Shape);
Cord.prototype.bend = function () { this.bent = !this.bent; return this; };
for (const kind of [Ring, Chain, Cord]) { kind.known = Shape.known; kind.note = Shape.note; }
function total(list) { let sum = 0; for (const each of list) { each.grow(1); sum += each.parts + (each.links || 0); } return sum; }
const made = [];
for (let i = 0; i < 40; i++) made.push(i % 3 === 0 ? new Ring("r" + i, i) : i % 3 === 1 ? new Chain("c" + i, i, 2) : new Cord("o" + i).bend());
console.log(total(made), total(made), made.slice(0, 6).map(each => each.told()).join());
for (const kind of [Ring, Chain, Cord]) {
  const proto = kind.prototype;
  console.log(kind.name, proto.constructor === kind, proto.above.name, Object.getPrototypeOf(kind) === proto.above, Object.keys(proto).join("|"), JSON.stringify(Object.getOwnPropertyDescriptor(proto, "above"), (k, v) => (typeof v === "function" ? v.name : v)), JSON.stringify(Object.getOwnPropertyDescriptor(proto, "constructor"), (k, v) => (typeof v === "function" ? v.name : v)));
  console.log([kind.note === Shape.note, kind.known === Shape.known, Object.hasOwn(kind, "note"), new kind("x", 1, 2) instanceof Shape, new kind("x") instanceof Ring].join());
  try { proto.above = null; } catch (error) { console.log(error.constructor.name); }
  try { delete proto.above; } catch (error) { console.log(error.constructor.name); }
  proto.constructor = Shape; console.log(new kind("y").constructor.name); proto.constructor = kind;
  const listed = []; for (const name in new kind("z", 3, 4)) listed.push(name); console.log(listed.join());
}
console.log(Chain.note(new Chain("noted", 1, 1)).told(), Ring.known.join(), Cord.known.length);
// The parent changes behind the objects that were made.
Object.setPrototypeOf(Cord.prototype, Ring.prototype); console.log(made[2].told(), made[2] instanceof Ring);
Ring.prototype.told = () => "other"; console.log(made[0].told(), made[2].told(), made[1].told());
delete Ring.prototype.told; console.log(made[0].told(), made[1].told());
for (const bad of [undefined, null, 5, {}, () => {}]) { try { const kind = function () {}; layBelow(kind, bad); console.log(Object.getPrototypeOf(kind.prototype) === bad.prototype); } catch (error) { console.log(error.constructor.name); } }
try { layBelow({}, Shape); console.log("an object"); } catch (error) { console.log(error.constructor.name); }
