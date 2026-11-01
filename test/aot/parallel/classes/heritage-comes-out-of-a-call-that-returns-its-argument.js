// `class B extends pass(A)`, where pass returns its own parameter, or only looks as if it did.
function same(made) { return made; }
function counted(made, log) { return log.push(made.name), made; }
function other(made) { made = class Replaced { base() { return "replaced"; } }; return made; }
function either(made, second) { if (second) return second; return made; }
function refuses(made) { if (made.name === "A") throw new TypeError("no parent"); return made; }
class A { constructor() { this.z = 1; } base() { return "a " + this.z; } static made() { return "static a"; } }
class Stranger { constructor() { this.z = 5; } base() { return "stranger " + this.z; } static made() { return "static stranger"; } }
const log = [];
class Same extends same(A) { constructor() { super(); this.own = 2; } }
class Counted extends counted(A, log) { base() { return "counted " + super.base(); } }
class Other extends other(A) {}
class First extends either(A) {}
class Second extends either(A, Stranger) {}
const lines = [];
try { class Refused extends refuses(A) {} lines.push(Refused.name); } catch (error) { lines.push("refused: " + error.message); }
const describe = (label, Class) => { const made = new Class(); lines.push(label + ": " + made.base() + " | " + Object.keys(made).join() + " | " + (made instanceof A) + " " + (made instanceof Stranger) + " | " + (typeof Class.made === "function" ? Class.made() : "none") + " | " + Object.getPrototypeOf(Class).name); };
for (let round = 0; round < 3; round++) {
  describe("same", Same);
  describe("counted", Counted);
  describe("other", Other);
  describe("first", First);
  describe("second", Second);
}
lines.push(log.join());
console.log(lines.join("\n"));
