// `shape.area(next())` goes through the method table. A getter comes to lie under the name, on the prototype object and on one receiver: it runs once for each call, in front of the argument
class Square { area(n) { return "square" + n; } }
class Disk extends Square { area(n) { return "disk" + n; } }
let order = "";
function next() { order += "a"; return 1; }
function areaOf(shape) { return shape.area(next()); }
function deed(shape) { order = ""; const answer = areaOf(shape); return answer + " " + order; }
console.log(deed(new Square()), deed(new Disk()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new Square() : new Disk());
console.log(log);
Object.defineProperty(Disk.prototype, "area", { configurable: true, get() { order += "g"; return function (n) { return "got" + n; }; } });
console.log(deed(new Disk()), deed(new Square()));
const own = new Square();
Object.defineProperty(own, "area", { get() { order += "o"; return function (n) { return "own" + n; }; } });
console.log(deed(own), deed(new Square()));
