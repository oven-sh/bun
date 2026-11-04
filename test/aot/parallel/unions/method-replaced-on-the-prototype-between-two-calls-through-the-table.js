// `shape.area()` goes through the method table. Between two calls text that nobody has seen replaces the method on one prototype object, deletes it from another, and puts both back
class Square { area() { return "square"; } }
class Disk extends Square { area() { return "disk"; } }
class Ring extends Square { area() { return "ring"; } }
function areaOf(shape) { return shape.area(); }
const shapes = [new Square(), new Disk(), new Ring()];
function deed() { let log = ""; for (let i = 0; i < shapes.length; i++) log += areaOf(shapes[i]) + " "; return log; }
console.log(deed());
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed();
console.log(log);
const kept = Disk.prototype.area;
(0, eval)("(function (Disk) { Disk.prototype.area = function () { return 'replaced'; }; })")(Disk);
console.log(deed());
delete Ring.prototype.area;
console.log(deed());
Disk.prototype.area = kept;
Ring.prototype.area = function () { return "ring again"; };
console.log(deed());
