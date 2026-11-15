// The objects of a constructor function whose fields are stored by methods on its prototype.
var log = [];
var State = function () {
  function State() {}
  var proto = State.prototype;
  proto.init = function init(options, input) { this.input = input; this.pos = this.start = 0; this.value = options.value; this.tokens = []; return this; };
  proto.clone = function clone() { var self = this, copy = new State(); Object.keys(this).forEach(function (key) { copy[key] = Array.isArray(self[key]) ? self[key].slice() : self[key]; }); return copy; };
  proto.next = function next() { while (this.pos < this.input.length && this.input.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.input.slice(this.start, this.pos); this.start = ++this.pos; this.last = this.value; return this.value; };
  proto.forget = function forget() { delete this.value; this.start = undefined; if (this.pos > 9) this.late = -0; };
  return State;
}();
function show(o) { return Object.keys(o).map(function (k) { return k + "=" + (Object.is(o[k], -0) ? "-0" : Array.isArray(o[k]) ? "[" + o[k] + "]" : String(o[k])); }).join(" "); }
for (var turn = 0; turn < 60; turn++) {
  var state = new State();
  if (turn === 0) log.push(show(state), "pos" in state, state.pos, state.value);
  state.init({ value: turn }, "let alpha beta gamma");
  var words = []; for (var i = 0; i < 4; i++) words.push(state.next());
  var copy = state.clone(); copy.forget();
  if (turn % 20 === 0) log.push(words.join(), show(state), show(copy), "value" in copy, JSON.stringify(copy));
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
class Heir extends State { constructor() { super(); this.heir = 1; } } var heir = new Heir(); log.push(show(heir), heir.pos); heir.init({ value: 2 }, "x y"); log.push(show(heir), heir.next());
Later.prototype.a = function () { this.q = 8; }; var changed = new Later(); changed.a(); log.push(show(changed), changed.x);
console.log(log.join("\n"));
