// STATISTIC: SlotsCarriedAroundLoops >= 2
"use strict";
// A constructor function fills one field and a method of its prototype the others: they are fields of its objects as those of a class are.
var State = function () {
  function State() { this.strict = true; }
  var proto = State.prototype;
  proto.init = function init(options, input) { this.input = input; this.pos = this.lineStart = 0; this.type = null; this.value = options.value; };
  proto.cur = function () { return this.pos - this.lineStart; };
  return State;
}();
var Tokens = function () {
  function Tokens(options, input) { this.state = new State(); this.state.init(options, input); this.input = input; }
  var proto = Tokens.prototype;
  proto.word = function () { var n = 0; while (this.state.pos < this.input.length) { var c = this.input.charCodeAt(this.state.pos); if (c === 32) break; this.state.pos += 1; n += c; } return n; };
  proto.skip = function () { while (this.state.pos < this.input.length && this.input.charCodeAt(this.state.pos) === 32) ++this.state.pos; };
  proto.all = function () { var s = 0; while (this.state.pos < this.input.length) { this.skip(); this.state.type = "w"; s += this.word(); this.state.value = s; } return s; };
  return Tokens;
}();
function show(o) { return Object.keys(o).map(function (k) { return k + "=" + String(o[k]); }).join(); }
for (const text of ["", "one", "let  alpha beta  12 gamma ", " "]) {
  const tokens = new Tokens({ value: 3 }, text);
  console.log(text.length, tokens.all(), tokens.state.cur(), tokens.state.strict, JSON.stringify(tokens.state));
}
// Objects that the method has not filled, that others fill, and whose prototype answers.
function Node(kind) { this.kind = kind; }
Node.prototype.annotate = function (n) { this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; return this; };
Node.prototype.sum = function () { return this.a + this.b + this.c + this.d; };
const plain = new Node(1), full = new Node(2).annotate(5), part = new Node(3);
part.b = 4;
console.log(show(plain), plain.sum(), show(full), full.sum(), show(part), part.sum(), "a" in plain, "a" in full, plain.hasOwnProperty("d"));
delete full.c;
console.log(show(full), full.sum());
Node.prototype.a = 100;
console.log(plain.a, full.a, part.sum(), show(new Node(4)), Object.keys(new Node(5).annotate(1)).join());
Object.defineProperty(Node.prototype, "d", { get() { return 7; }, set(v) { this.kept = v; }, configurable: true });
const late = new Node(6).annotate(1);
console.log(show(late), late.d, show(Object.assign(new Node(7), { c: 1, a: 2 })));
