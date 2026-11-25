// `shape.area()` goes through the method table by the shape of the receiver. One receiver keeps its shape and is laid below another prototype object, where the name finds another function, or none
class Square { area() { return "square"; } }
class Disk extends Square { area() { return "disk"; } }
function areaOf(shape) { return shape.area(); }
function deed(shape) { try { return areaOf(shape); } catch (error) { return error instanceof TypeError ? "TypeError" : "other"; } }
console.log(deed(new Square()), deed(new Disk()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new Square() : new Disk());
console.log(log);
const moved = new Disk();
Object.setPrototypeOf(moved, { area() { return "moved"; } });
console.log(deed(moved));
Object.setPrototypeOf(moved, Square.prototype);
console.log(deed(moved));
Object.setPrototypeOf(moved, null);
console.log(deed(moved));
console.log(deed(new Square()), deed(new Disk()));
