// Files that are joined begin with the same lines: one of their literals makes the namespace, so they share a layout.
// RUN: link
// CHECK-NOT: layout {{*}}module=m0 position=499 
// CHECK-NOT: layout {{*}}module=m0 position=537 
// CHECK-NOT: layout {{*}}module=m0 position=656 

if (typeof Shapes == "undefined") var Shapes = {};
if (typeof Shapes.Plane == "undefined") Shapes.Plane = {};
Shapes.Plane.Circle = function () {
  this.radius = 1;
};

if (typeof Shapes == "undefined") var Shapes = {};
if (!Shapes.Plane) Shapes.Plane = {};
Shapes.Plane.Square = function () {
  this.side = 2;
};

var Shapes = Shapes || {};
Shapes.Plane = Shapes.Plane || {};
Shapes.Plane.Line = function () {
  this.length = 3;
};

exports.made = [new Shapes.Plane.Circle(), new Shapes.Plane.Square(), new Shapes.Plane.Line()];
