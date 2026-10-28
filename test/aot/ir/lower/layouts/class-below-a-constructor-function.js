// RUN: link
// The checker sees no class in the heritage. Its binding names a function that stores into `this`: that function makes the objects
// of the class, so its layout is the base.
// CHECK: layout [[shape]] kind=Instance name="Shape" {{*}}fields=[{key="area"{{*}}flags=[IsConstructorFunction]
// CHECK: layout [[solid]] kind=Instance name="Solid" {{*}} base=[[shape]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}kind=Instance name="Box" {{*}} base=[[solid]] {{*}}fields=[{key="lid"
// CHECK-NOT: {key=
// CHECK: supertypes=[{{*}}[[solid]]] flags=[HasHeritage]

// RUN(IMPORTED): link
// IMPORTED: layout [[meter]] kind=Instance name="Meter" {{*}}flags=[IsConstructorFunction]
// IMPORTED: layout {{*}}kind=Instance name="Fine" {{*}} base=[[meter]] {{*}}flags=[HasHeritage]

// RUN(CHOSEN): link
// CHOSEN-NOT: layout {{*}}name="Either"{{*}} base=
// CHOSEN-NOT: layout {{*}}name="Stored"{{*}} base=

import { Meter } from "./imports/meter";

function Shape() {
  this.area = 0;
}
Shape.prototype.grow = function (by) {
  this.area += by;
};

function Solid(depth) {
  Shape.call(this);
  this.depth = depth;
}
Object.setPrototypeOf(Solid.prototype, Shape.prototype);

export class Box extends Solid {
  lid = true;
}

export class Fine extends Meter {}

export class Either extends (Math.random() < 0.5 ? Shape : Solid) {}

let Base = Shape;
Base = Solid;
export class Stored extends Base {}
