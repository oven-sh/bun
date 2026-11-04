// A constructor function is handed through a function that returns its own parameter, as Babel's _createClass does, and a child is linked to what came out. Beside it: functions that only look as if they did.
function same(made) { return made; }
function sameBehindWork(made, list) { return list && list.push(made.name), made; }
function other(made) { made = function Replaced() { this.z = 9; }; made.prototype.base = function () { return "replaced " + this.z; }; return made; }
function either(made, second) { if (second) return second; return made; }
function withDefault(made = function Default() { this.z = 7; }) { return made; }
function throughArguments(made) { arguments[0] = Stranger; return made; }
function Stranger() { this.z = 5; }
Stranger.prototype.base = function () { return "stranger " + this.z; };
function inherits(child, parent) {
  child.prototype = Object.create(parent && parent.prototype, { constructor: { value: child, writable: true, configurable: true } });
  if (parent) Object.setPrototypeOf(child, parent);
}
const seen = [];
function define(pass, ...more) {
  var Base = (function () {
    function Base() { this.z = 1; }
    Base.prototype.base = function () { return "base " + this.z; };
    return pass(Base, ...more);
  })();
  var Child = (function (_Base) {
    function Child(a) { _Base.call(this); this.a = a; }
    inherits(Child, _Base);
    return same(Child);
  })(Base);
  return Child;
}
var Plain = (function () {
  function Plain() { this.z = 1; }
  Plain.prototype.base = function () { return "plain " + this.z; };
  return sameBehindWork(Plain, seen);
})();
var Below = (function (_Plain) {
  function Below(a) { _Plain.call(this); this.a = a; }
  inherits(Below, _Plain);
  return same(Below);
})(Plain);
var NoParent = (function () {
  function NoParent() { this.z = 3; }
  inherits(NoParent, null);
  return same(NoParent);
})();
const lines = [];
const describe = (label, made) => lines.push(label + ": " + (typeof made.base === "function" ? made.base() : "no base") + " | " + Object.keys(made).join() + " | " + made.constructor.name + " | " + (Object.getPrototypeOf(Object.getPrototypeOf(made)) === Object.prototype));
for (let round = 0; round < 3; round++) {
  describe("below", new Below(round));
  describe("same", new (define(same))(round));
  describe("other", new (define(other))(round));
  describe("either, first", new (define(either))(round));
  describe("either, second", new (define(either, Stranger))(round));
  describe("default", new (define(withDefault))(round));
  describe("arguments", new (define(throughArguments))(round));
  lines.push("no parent: " + Object.keys(new NoParent()).join() + " " + (Object.getPrototypeOf(NoParent.prototype) === null));
}
lines.push(seen.join());
console.log(lines.join("\n"));
