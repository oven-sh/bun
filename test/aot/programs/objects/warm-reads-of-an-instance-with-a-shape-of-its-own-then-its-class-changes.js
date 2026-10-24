// Instances of a class get so many properties that the class does not declare, or lose one of them, that each has a shape of its own. They read a method, a getter and absent names, warm: then the prototype object of the class changes
class Box {
  constructor(i) { this.size = i; }
  area() { return this.size * 2; }
  get half() { return this.size / 2; }
}
class Crate extends Box {
  lid() { return "lid" + this.size; }
}
function crowd(o, n) { for (let i = 0; i < n; i++) o["extra" + i] = i; return o; }
const plain = new Box(1), few = crowd(new Box(2), 3), many = crowd(new Box(3), 200), holed = crowd(new Box(4), 12), heir = crowd(new Crate(5), 200), heirHoled = crowd(new Crate(6), 12);
delete holed.extra5; delete heirHoled.extra7; delete heirHoled.extra2;
const all = [plain, few, many, holed, heir, heirHoled];
function read(o) { return [o.area(), o.half, o.later, o.never, typeof o.lid, o.extra1, o.toString === Object.prototype.toString, "later" in o, "area" in o]; }
function tally(label) {
  let last;
  for (let round = 0; round < 60; round++) last = all.map(o => read(o).join(" "));
  console.log(label);
  for (const line of last) console.log("  ", line);
}
tally("as the classes declare them:");
Box.prototype.later = 1;
tally("the prototype object gets a name:");
Box.prototype.area = function () { return this.size * 20; };
tally("a method is replaced:");
Object.defineProperty(Box.prototype, "half", { get() { return -this.size; }, configurable: true });
tally("a getter is replaced:");
delete Box.prototype.later;
tally("the name goes again:");
Crate.prototype.area = function () { return "crate"; };
tally("the heir's prototype object hides a method:");
Object.setPrototypeOf(Crate.prototype, { area() { return "other"; }, later: "from the other" });
tally("the heir's prototype object gets another object above it:");
delete Crate.prototype.area;
tally("what hid the method goes:");
Object.setPrototypeOf(Box.prototype, { never: "now" });
tally("an object comes above the prototype object:");
Box.prototype.toString = function () { return "box"; };
tally("a name of Object.prototype is hidden:");
