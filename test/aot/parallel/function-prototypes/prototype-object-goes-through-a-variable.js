// The object that becomes a function's prototype is made first and held in a variable: alone, shared by two functions, changed on the way, or not the one that the variable began with.
function Base() { this.z = 1; }
Base.prototype.base = function () { return "base " + this.z; };
function Other() { this.z = 2; }
Other.prototype.base = function () { return "other " + this.z; };

function Plain(a) { Base.call(this); this.a = a; }
var plain = Object.create(Base.prototype);
plain.constructor = Plain;
Plain.prototype = plain;

function First(a) { Base.call(this); this.a = a; }
function Second(a) { Base.call(this); this.b = a; }
const shared = Object.create(Base.prototype);
First.prototype = shared;
Second.prototype = shared;
shared.both = function () { return "both"; };

function Relinked(a) { Base.call(this); this.a = a; }
const relinked = Object.create(Base.prototype);
Object.setPrototypeOf(relinked, Other.prototype);
Relinked.prototype = relinked;

function Reassigned(a) { Base.call(this); this.a = a; }
var reassigned = Object.create(Base.prototype);
reassigned = Object.create(Other.prototype);
Reassigned.prototype = reassigned;

function Late(a) { Base.call(this); this.a = a; }
const early = new Late(0);
const late = Object.create(Base.prototype);
Late.prototype = late;

function link(child, parent) { var made = Object.create(parent.prototype); made.constructor = child; child.prototype = made; }
function Helped(a) { Base.call(this); this.a = a; }
function HelpedToo(a) { Other.call(this); this.a = a; }
link(Helped, Base);
link(HelpedToo, Other);

const lines = [];
const describe = (label, made) => lines.push(label + ": " + (typeof made.base === "function" ? made.base() : "no base") + " | " + Object.keys(made).join() + " | " + (made instanceof Base) + " " + (made instanceof Other) + " | " + made.constructor.name);
for (let round = 0; round < 3; round++) {
  describe("plain", new Plain(round));
  describe("first", new First(round));
  describe("second", new Second(round));
  lines.push("shared: " + new First(1).both() + " " + new Second(1).both() + " " + (Object.getPrototypeOf(new First(1)) === Object.getPrototypeOf(new Second(1))) + " " + (new First(1) instanceof Second));
  describe("relinked", new Relinked(round));
  describe("reassigned", new Reassigned(round));
  describe("early", early);
  describe("late", new Late(round));
  describe("helped", new Helped(round));
  describe("helped too", new HelpedToo(round));
}
console.log(lines.join("\n"));
