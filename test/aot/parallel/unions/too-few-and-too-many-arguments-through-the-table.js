// methods of one name that take none, two and six parameters are called through the method table with none, one and four arguments, and with five, which is more than the table takes
class Square { area(a, b) { return "square " + String(a) + " " + String(b); } }
class Disk extends Square { area() { return "disk"; } }
class Ring extends Square { area(a, b, c, d, e, f) { return "ring " + String(a) + " " + String(b) + " " + String(c) + " " + String(d) + " " + String(e) + " " + String(f); } }
function none(shape) { return shape.area(); }
function one(shape) { return shape.area(1); }
function four(shape) { return shape.area(1, 2, 3, 4); }
function five(shape) { return shape.area(1, 2, 3, 4, 5); }
const shapes = [new Square(), new Disk(), new Ring()];
function deed() { let log = ""; for (let i = 0; i < shapes.length; i++) log += none(shapes[i]) + ", " + one(shapes[i]) + ", " + four(shapes[i]) + ", " + five(shapes[i]) + "; "; return log; }
console.log(deed());
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed();
console.log(log);
