// RUN: link
// The walk from a stored prototype object to what it was created below follows a variable into its initializer. A `var` may name itself there, or two may name each other:
// it is followed once, and such an object says nothing of a parent.
// CHECK: layout {{*}}kind=Instance name="Shape" {{*}}flags=[IsConstructorFunction]
// CHECK-NOT: layout {{*}}name="Shape"{{*}} base=
// CHECK: layout [[base]] kind=Instance name="Base" {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}kind=Instance name="Below" {{*}} base=[[base]]

function Shape() {
  this.sides = 4;
}
function copiesOntoItself() {
  var proto = Object.assign(proto, { area() { return 1; } });
  Shape.prototype = proto;
}
function lastOfAComma() {
  var proto = (0, proto);
  Shape.prototype = proto;
}
function twoNames() {
  var a = Object.assign(b, {}), b = Object.assign(a, {});
  Shape.prototype = a;
}
function oneArm() {
  var proto = Shape != null ? proto : null;
  Shape.prototype = proto;
}

// The control: a variable that is followed to its end.
function Base() {
  this.depth = 1;
}
function Below() {
  this.height = 2;
}
var created = Object.create(Base.prototype);
var filled = Object.assign(created, { area() { return 1; } });
Below.prototype = filled;

console.log(new Shape().sides, new Below().height, new Base().depth, [copiesOntoItself, lastOfAComma, twoNames, oneArm].length);
