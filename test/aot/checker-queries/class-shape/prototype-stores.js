// Prototype stores and object literals add members to a constructor function; a prototype from a call and `__proto__` add none.
function F() {
  this.a = 1;
}
F.prototype.m = function () {};
F.prototype.v = 1;
function G() {}
G.prototype = {
  m() {},
  get g() { return 1; },
  v: 1,
  f: function () {},
};
function H() {
  this.a = 1;
}
H.prototype = Object.create(F.prototype);
F.prototype.arrow = () => {};
F.prototype.__proto__ = G.prototype;
let text = "";
function I() {
  this.a = 1;
  this.__proto__ = G.prototype;
}
I.prototype = {
  __proto__: G.prototype,
  v: text += function () {},
};
