// a call by name over a family of classes goes through the method table; between two calls a method is replaced on a prototype, an object is laid below another prototype, and an object gets the name for itself
class Shape { area() { return "shape"; } }
class Circle extends Shape { area() { return "circle"; } }
class Square extends Shape { area() { return "square"; } }
function areaOf(shape) { return shape.area(); }
const shapes = [new Shape(), new Circle(), new Square()];
function deed() { let log = ""; for (let i = 0; i < shapes.length; i++) log += areaOf(shapes[i]) + " "; return log; }
console.log(deed());
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed();
console.log(last);
Circle.prototype.area = function () { return "replaced"; };
console.log(deed());
Object.setPrototypeOf(shapes[2], { area() { return "moved"; } });
console.log(deed());
shapes[0].area = () => "own";
console.log(deed());
delete Circle.prototype.area;
console.log(deed());
