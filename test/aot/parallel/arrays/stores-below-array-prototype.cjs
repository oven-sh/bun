// Fields that a constructor stores below Array.prototype: length, a method's name, a setter in between, a frozen object in between, an array as the prototype.
"use strict";
let log = [];
function Collection(list) { this.length = 0; for (const each of list) { this[this.length] = each; this.length++; } this.map = list.length; this.kept = { list }; this.at = "own"; }
const base = Collection.prototype = Object.create(Array.prototype);
base.first = function () { return this[0]; };
function Watched(list) { this.length = list.length; this.total = list.length; this.name = "w"; }
Watched.prototype = Object.create(Array.prototype, { total: { set(v) { log.push("total " + v); }, get() { return "got"; }, configurable: true } });
function Held(list) { this.length = list.length; this.kind = "held"; }
Held.prototype = Object.create(Object.freeze(Object.create(Array.prototype, { kind: { value: "above" } })));
function Below(list) { this.length = list.length; this[0] = list; this.flag = 1; }
Below.prototype = [7, 8, 9];
function Fixed(list) { this.length = list.length; this.flag = 2; }
Fixed.prototype = Object.defineProperty([1, 2], "length", { writable: false });
function Late(list) { this.length = list.length; this.flag = 3; this.kind = list; }
Late.prototype = Object.create(Array.prototype);
const makers = [Collection, Watched, Held, Below, Fixed, Late];
const show = o => Object.getOwnPropertyNames(o).map(k => k + "=" + JSON.stringify(Object.getOwnPropertyDescriptor(o, k))).join() + " " + o.length + " " + Array.isArray(o);
for (let round = 0; round < 60; round++) for (const maker of makers) {
  let r; try { r = show(new maker([round, "x"])); } catch (e) { r = e.constructor.name; }
  if (round < 2 || round > 56 || (round > 28 && round < 34)) console.log(round, maker.name, r, log.join());
  log = [];
  if (round === 30 && maker === Late) Object.defineProperty(Late.prototype, "flag", { set(v) { log.push("flag " + v); }, configurable: true });
  if (round === 31 && maker === Collection) Object.defineProperty(base, "kept", { value: 1, writable: false, configurable: true });
  if (round === 32 && maker === Collection) delete base.kept;
  if (round === 57 && maker === Below) Object.freeze(Below.prototype);
  if (round === 58 && maker === Late) Object.setPrototypeOf(Late.prototype, Object.freeze(["frozen"]));
}
console.log(new Collection([1, 2, 3]).filter(x => x > 1).length, new Collection([3]).first(), [].concat(new Collection([4])).length, new Collection([5, 6]).join());
