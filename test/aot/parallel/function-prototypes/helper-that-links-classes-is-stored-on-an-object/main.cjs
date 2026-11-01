// The function that links a constructor function to its parent is stored under a name of an object that a variable holds: once, twice, late, inside a function, or on an object that another file hands out.
const lines = [];
function Base() { this.z = 1; }
Base.prototype.base = function () { return "base " + this.z; };
function Other() { this.z = 2; }
Other.prototype.base = function () { return "other " + this.z; };
const toBase = function (child) { child.prototype = Object.create(Base.prototype); child.prototype.constructor = child; };
const toOther = function (child) { child.prototype = Object.create(Other.prototype); child.prototype.constructor = child; };
const inherits = function (child, parent) { child.prototype = Object.create(parent.prototype); child.prototype.constructor = child; };

var once = {};
once.inherits = inherits;
function Once(a) { Base.call(this); this.a = a; }
once.inherits(Once, Base);

var twice = {};
twice.link = toBase;
twice.link = toOther;
function Twice(a) { Other.call(this); this.a = a; }
twice.link(Twice);

var replaced = {};
replaced.link = toBase;
function replace() { replaced.link = toOther; }
replace();
function Replaced(a) { Other.call(this); this.a = a; }
replaced.link(Replaced);

var inLiteral = { link: toBase };
inLiteral.link = toOther;
function InLiteral(a) { Other.call(this); this.a = a; }
inLiteral.link(InLiteral);

var late = {};
function Late(a) { Base.call(this); this.a = a; }
try { late.link(Late); } catch (error) { lines.push("late: " + error.constructor.name); }
late.link = toBase;

var removed = {};
removed.link = toBase;
delete removed.link;
function Removed(a) { Base.call(this); this.a = a; }
try { removed.link(Removed); } catch (error) { lines.push("removed: " + error.constructor.name); }

var copied = {};
Object.assign(copied, { link: toOther });
function Copied(a) { Other.call(this); this.a = a; }
copied.link(Copied);

const util = require("./util.cjs");
function Across(a) { Base.call(this); this.a = a; }
util.inherits(Across, Base);
const both = require("./both.cjs");
function AcrossBoth(a) { Other.call(this); this.a = a; }
both.inherits(AcrossBoth, Other);

const describe = (label, made) => lines.push(label + ": " + (typeof made.base === "function" ? made.base() : "no base") + " | " + Object.keys(made).join() + " | " + (made instanceof Base) + " " + (made instanceof Other) + " | " + made.constructor.name);
for (let round = 0; round < 3; round++) {
  describe("once", new Once(round));
  describe("twice", new Twice(round));
  describe("replaced", new Replaced(round));
  describe("in the literal", new InLiteral(round));
  describe("late", new Late(round));
  describe("removed", new Removed(round));
  describe("copied", new Copied(round));
  describe("across", new Across(round));
  describe("across both", new AcrossBoth(round));
}
console.log(lines.join("\n"));
