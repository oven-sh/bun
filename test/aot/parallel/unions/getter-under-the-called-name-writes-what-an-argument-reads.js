// `shape.area(scale)` goes through the method table. A getter comes to lie under the name and writes the variable that the argument reads: the name is read in front of the argument, so the call is handed what the getter wrote
class Square { area(n) { return "square" + n; } }
class Disk extends Square { area(n) { return "disk" + n; } }
let scale = 1;
function areaOf(shape) { return shape.area(scale); }
function deed(shape) { scale = 1; return areaOf(shape) + " " + scale; }
console.log(deed(new Square()), deed(new Disk()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new Square() : new Disk());
console.log(log);
Object.defineProperty(Disk.prototype, "area", { configurable: true, get() { scale = 2; return function (n) { return "got" + n; }; } });
console.log(deed(new Disk()), deed(new Square()));
for (let turn = 0; turn < 3; turn++) log = deed(turn & 1 ? new Square() : new Disk());
console.log(log);
const own = new Square();
Object.defineProperty(own, "area", { get() { scale = 3; return function (n) { return "own" + n; }; } });
console.log(deed(own), deed(new Square()));
