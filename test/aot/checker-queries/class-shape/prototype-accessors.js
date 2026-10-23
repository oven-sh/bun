// A name that a prototype literal defines as an accessor is not a field: `this.name = v` runs the setter.
function F() {
  this.g = 1;
  this.a = 2;
}
F.prototype = {
  get g() { return this.a; },
  set g(v) { this.a = v; },
};
F.g = 3;
function R() {
  this.g = 1;
  this.a = 2;
}
R.prototype = {
  set g(v) {},
};
R = null;
