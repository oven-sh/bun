// The body of a loop may be laid behind all that follows the loop. What follows runs once nevertheless: a function that calls itself there, and the classes that it evaluates. What a loop, a callback or a second call enters may run again.
// COUNT: operation:operationAOTEnterBodyThatRunsOnce >= 3
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function iterate(list) { let i = 0; return () => i < list.length ? { done: false, value: list[i++] } : { done: true, value: undefined }; }
var kinds = {};
for (var next = iterate(["a", "b", "c"]), step; !(step = next()).done;) { (function (name) { kinds[name] = function (n) { return name + n; }; })(step.value); }
var Base = (function () {
  function Base(x) { this.x = x; this.tags = []; }
  var proto = Base.prototype;
  proto.add = function add(o) { return new Base(this.x + o.x); };
  proto.tag = function tag(t) { this.tags.push(t); return this; };
  return Base;
})();
for (var name in kinds) { if (name === "b") continue; out.push(kinds[name](1)); }
var Heir = (function (Parent) {
  function Heir(x, y) { var self = Parent.call(this, x) || this; self.y = y; return self; }
  Heir.prototype = Object.create(Parent.prototype); Heir.prototype.constructor = Heir;
  Heir.prototype.sum = function sum() { return this.x + this.y + this.tags.length; };
  return Heir;
})(Base);
var made = [];
for (var again = iterate([1, 2, 3]), turn; !(turn = again()).done;) { made.push((function (n) { class Turn { constructor() { this.n = n; } read() { return this.n; } } return Turn; })(turn.value)); }
out.push(made.map((Class) => new Class().read()).join(), made[0] === made[1], made[0].prototype === made[2].prototype, new made[0]() instanceof made[1]);
var Klass = (() => { class Klass { static count = 0; constructor(v) { this.v = v; Klass.count++; } twice() { return this.v * 2; } } return Klass; })();
[1, 2].forEach(function (n) { class Each { constructor() { this.n = n; } } made.push(Each); });
var late = [], tries = 0;
while (tries < 4) { try { if (tries++ % 2) throw new RangeError("odd"); late.push((function () { class Tried { constructor() { this.t = tries; } } return Tried; })()); } catch (error) { late.push((function (e) { class Caught { constructor() { this.c = e.message; } } return Caught; })(error)); } finally { out.push(tries); } }
out.push(late.map((Class) => JSON.stringify(new Class())).join(), late[0] === late[2], late[1] === late[3]);
function twice() { return (function () { class Inner { constructor() { this.i = 1; } } return Inner; })(); }
out.push(twice() === twice(), new (twice())() instanceof twice());
label: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) continue label; if (i === 2) break label; out.push((function () { class Deep { constructor() { this.at = i + "," + j; } } return new Deep().at; })()); } }
var total = 0;
(function () { for (var k = 0; k < 200; k++) { total += new Base(k).add(new Base(1)).tag(k).x + new Heir(k, 2).tag(1).sum() + new Klass(k).twice(); } })();
out.push(total, Klass.count, new Heir(1, 2) instanceof Base, Object.keys(new Heir(3, 4)).join(), show(() => Heir.prototype.sum.call({ x: 1, y: 2 })), show(() => Base.prototype.add.call(null, 1)));
Base.prototype.add = function () { return "replaced"; };
out.push(new Heir(1, 2).add(3), new Base(1).add(2));
for (const line of out) console.log(line);
