// The objects of a constructor function whose fields are stored by methods on its prototype.
var log = [];
var Jar = function () {
  function Jar() {}
  var shelf = Jar.prototype;
  shelf.fill = function fill(order, words) { this.lids = []; this.words = words; this.label = order.label; this.first = this.at = 0; return this; };
  shelf.twin = function twin() { var made = new Jar(); for (var part in this) if (Object.hasOwn(this, part)) { var held = this[part]; made[part] = held instanceof Array ? held.concat() : held; } return made; };
  shelf.next = function next() { var till = this.words.indexOf(" ", this.first); if (till < 0) till = this.words.length; this.label = this.words.substring(this.first, till); this.at = this.first = till + 1; this.last = this.label; return this.label; };
  shelf.forget = function forget() { delete this.label; this.first = undefined; if (this.at > 9) this.late = -0; };
  return Jar;
}();
function show(o) { return Object.keys(o).map(function (k) { return k + "=" + (Object.is(o[k], -0) ? "-0" : Array.isArray(o[k]) ? "[" + o[k] + "]" : String(o[k])); }).join(" "); }
for (var turn = 0; turn < 60; turn++) {
  var jar = new Jar();
  if (turn === 0) log.push(show(jar), "at" in jar, jar.at, jar.label);
  jar.fill({ label: turn }, "let alpha beta gamma");
  var told = []; for (var i = 0; i < 4; i++) told.push(jar.next());
  var twin = jar.twin(); twin.forget();
  if (turn % 20 === 0) log.push(told.join(), show(jar), show(twin), "label" in twin, JSON.stringify(twin));
}
// The order is the order of the stores, not that of the methods.
function Later() { this.own = 1; }
Later.prototype.a = function () { this.x = 1; this.y = 2; }; Later.prototype.b = function () { this.y = 3; this.x = 4; this.own++; };
var first = new Later(), second = new Later(); first.a(); second.b(); log.push(show(first), show(second), show(Object.assign(new Later(), second)), show({ ...first }));
// A name that the prototype holds, an accessor, a read-only value, other receivers, frozen objects.
function Over() {} Over.prototype = { kind: "proto", set: function () { this.kind = "own"; this.size = 5; this.fixed = 6; }, get fixed() { return 7; }, constructor: Over };
var over = new Over(); log.push(over.kind, over.size); try { over.set(); } catch (e) { log.push(e.constructor.name); } log.push(over.kind, over.size, over.fixed, show(over)); delete over.kind; log.push(over.kind);
var other = { z: 1 }; Later.prototype.b.call(other); log.push(show(other)); var frozen = Object.freeze(new Later()); frozen.a(); log.push(show(frozen));
function Below() { Later.call(this); this.below = true; } Below.prototype = Object.create(Later.prototype); Below.prototype.b = function () { Later.prototype.b.call(this); this.mine = this.x; }; var below = new Below(); below.b(); below.a(); log.push(show(below));
class Heir extends Jar { constructor() { super(); this.heir = 1; } } var heir = new Heir(); log.push(show(heir), heir.at); heir.fill({ label: 2 }, "x y"); log.push(show(heir), heir.next());
Later.prototype.a = function () { this.q = 8; }; var changed = new Later(); changed.a(); log.push(show(changed), changed.x);
console.log(log.join("\n"));
