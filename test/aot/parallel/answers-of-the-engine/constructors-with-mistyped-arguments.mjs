// Classes with declared fields are constructed with seven values that are not what was declared, below another new.target, and called without new. What a constructor says it says once, and each object has its fields in the order of the text.
// Where a guess about a list fails, `for of` goes by the protocol and calls `next` of the iterators of arrays, which is a function of the library. So the text brings that function.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
let said = "";
class Point { x; y; constructor(x, y) { said += "p"; this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class Named extends Point { name; constructor(name, x) { said += "n"; super(x, x + 1); this.name = name; } text() { return this.name + this.sum(); } }
class Counted { static made = 0; id = ++Counted.made; label; constructor(label) { this.label = label; } }
function make(x, y) { const made = new Point(x, y); return typeof made.x + ":" + made.sum(); }
function makeNamed(name, x) { const made = new Named(name, x); return made.text() + ":" + Object.keys(made).join(); }
function makeCounted(label) { const made = new Counted(label); return made.id + ":" + made.label; }
class Other { other() { return "other"; } }
const odd = [1, 2.5, "3", undefined, null, { valueOf() { said += "v"; return 4; } }, true];
for (const one of odd) { report(make(one, 1)); report(make(1, one)); report(makeNamed(one, 1)); report(makeNamed("n", one)); report(makeCounted(one)); }
const under = Reflect.construct(Point, ["a", 2], Other);
report(under.other() + ":" + under.x + under.y + ":" + (under instanceof Point));
try { Point(1, 2); }
catch (error) { report(error.name); }
report(said);
report("end");
