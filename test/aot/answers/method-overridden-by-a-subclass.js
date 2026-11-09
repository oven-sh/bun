// answers: without-library
// # The receivers are a family whose members find different functions under one name, and `this.area()` in the base class finds the one of the receiver's own class.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
class Shape { constructor(edge) { this.edge = edge } area() { return this.edge } twice() { return this.area() * 2 } }
class Square extends Shape { constructor(edge) { super(edge); this.corners = 4 } area() { return this.edge * this.edge } }
class Cube extends Square { constructor(edge) { super(edge); this.faces = 6 } }
function areaOf(shape) { return shape.area() }
function pick(which) { return which === 0 ? new Shape(3) : which === 1 ? new Square(3) : new Cube(4) }
for (let which = 0; which < 3; which++) { report(areaOf(pick(which))); }
for (let which = 0; which < 3; which++) { report(pick(which).twice()); }
report(new Shape(5).area());
report(new Square(5).area());
report(new Cube(5).area());
report("end");
