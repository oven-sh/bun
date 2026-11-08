// `shape.area(swap())`: the method is read in front of the argument, and the argument replaces it. The call enters what the read has found, and the next call what was laid there
class Square { area(n) { return "square" + n; } }
class Disk extends Square { area(n) { return "disk" + n; } }
let swaps = false;
function swap() { if (swaps) Disk.prototype.area = function (n) { return "late" + n; }; return 1; }
function areaOf(shape) { return shape.area(swap()); }
function deed(shape) { return areaOf(shape); }
console.log(deed(new Square()), deed(new Disk()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new Square() : new Disk());
console.log(log);
swaps = JSON.parse("true");
console.log(deed(new Disk()));
console.log(deed(new Disk()), deed(new Square()));
