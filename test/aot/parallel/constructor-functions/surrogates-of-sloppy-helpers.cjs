// Helpers that construct a prototype object by a function of their own, in sloppy code.
var __extends = (this && this.__extends) || function (d, b) {
  function __() { this.constructor = d; }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var held = [];
function inherit(child, parent) {
  function Surrogate() { this.constructor = child; this.isGlobal = this === globalThis; }
  Surrogate.prototype = parent.prototype;
  child.prototype = new Surrogate();
}
function inheritAndHold(child, parent) {
  function Surrogate() { this.constructor = child; this.isGlobal = this === globalThis; }
  Surrogate.prototype = parent.prototype;
  child.prototype = new Surrogate();
  child.maker = Surrogate;
  held.push(Surrogate);
}

function Counter(n) { this.n = n; this.i = 0; }
Counter.prototype.step = function () { this.i = (this.i + 1) & 7; return this.i; };
Counter.prototype.get = function () { return this.n; };
function Extended(n) { var _this = Counter.call(this, n) || this; return _this; }
__extends(Extended, Counter);
Extended.prototype.own = function () { return this.get(); };
function Inherited(n) { Counter.call(this, n); }
inherit(Inherited, Counter);
Inherited.prototype.own = function () { return this.get() + 1; };
function Held(n) { Counter.call(this, n); }
inheritAndHold(Held, Counter);
Held.prototype.own = function () { return this.get() + 2; };

function run(list) {
  var s = 0;
  for (var i = 0; i < 100; i++) {
    var d = list[i & 3];
    s = (s + d.step() + d.own()) | 0;
  }
  return s;
}
function all(Constructor) { return [new Constructor(1), new Constructor(2), new Constructor(3), new Constructor(4)]; }
console.log(run(all(Extended)), run(all(Inherited)), run(all(Held)));
console.log(new Extended(1).constructor === Extended, new Inherited(1).constructor === Inherited, new Held(1).isGlobal, new Inherited(1).isGlobal);
console.log(new Extended(1) instanceof Counter, Object.getPrototypeOf(Inherited.prototype) === Counter.prototype, Object.keys(exports).length, this === exports);

held[0]();
console.log(globalThis.isGlobal, globalThis.constructor === Held);
var receiver = {};
Held.maker.call(receiver);
console.log(Object.keys(receiver).join(), receiver.isGlobal, new Held.maker().step());
delete globalThis.constructor;

exports.__extends = function (d, b) { d.prototype = Object.create(b.prototype); d.prototype.again = true; };
__extends = exports.__extends;
function Late(n) { Counter.call(this, n); }
__extends(Late, Counter);
Late.prototype.own = function () { return -this.get(); };
console.log(run(all(Late)), new Late(1).again, new Late(1).constructor === Counter);
