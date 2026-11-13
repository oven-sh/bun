// @ts-nocheck
// What decorators and static blocks put on the prototype of a class in place of a method, called before and after, inside loops.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e.name}: ${e.message}`; } console.log(label, String(r).slice(0, 80)); };
function getterOver(f, c) { c.addInitializer(function () { if (!Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), c.name).get) Object.defineProperty(Object.getPrototypeOf(this), c.name, { get() { return n => n + 700 + this.k; }, configurable: true }); }); }
class One { k = 1; @getterOver m(n) { return n + this.k; } }
let one = new One(); show("one", () => { let s = 0; for (let i = 0; i < 100; i++) s += one.m(i & 3); return s; });
class Two { k = 2; m(n) { return n + this.k; } static { Object.defineProperty(this.prototype, "m", { get() { return n => n * 3 + this.k; }, configurable: true }); } }
let two = new Two(); show("two", () => { let s = 0; for (let i = 0; i < 100; i++) s += two.m(i & 3); return s; });
class Three { k = 3; m(n) { return n + this.k; } }
let three = new Three(); show("three", () => { let s = 0; for (let i = 0; i < 100; i++) { if (i === 50) Object.defineProperty(Three.prototype, "m", { get() { return n => n * 5 + this.k; } }); s += three.m(i & 3); } return s; });
function wrap(f, c) { return function (n) { return f.call(this, n) + 40; }; }
class Four { k = 4; @wrap m(n) { return n + this.k; } }
let four = new Four(); show("four", () => { let s = 0; for (let i = 0; i < 100; i++) s += four.m(i & 3); return s; });
Object.defineProperty(Four.prototype, "m", { get() { return n => n + 9000; }, configurable: true });
show("four again", () => { let s = 0; for (let i = 0; i < 100; i++) s += four.m(i & 3); return s; });
class Five { k = 5; @wrap @wrap m(n) { return n + this.k; } @wrap q(n) { return n - this.k; } }
let five = new Five(); show("five", () => { let s = 0; for (let i = 0; i < 100; i++) s += five.m(i & 3) + five.q(i & 1); return s; });
class Six extends Five { w = 6; m(n) { return super.m(n) + 1; } }
let six = new Six(); show("six", () => { let s = 0; for (let i = 0; i < 100; i++) s += six.m(i & 3) + six.q(i & 1); return s; });
Five.prototype.q = function (n) { return n + 5000; };
show("six again", () => { let s = 0; for (let i = 0; i < 100; i++) s += six.m(i & 3) + six.q(i & 1); return s; });
class Seven { k = 7; static m(n) { return n + 1; } }
show("seven", () => { let s = 0; for (let i = 0; i < 100; i++) s += Seven.m(i & 3); return s; });
Object.defineProperty(Seven, "m", { get() { return n => n * 100; } });
show("seven again", () => { let s = 0; for (let i = 0; i < 100; i++) s += Seven.m(i & 3); return s; });
function undone(f, c) { return c.name === "keeps" ? undefined : function (n) { return n - 1; }; }
class Eight { k = 8; @undone keeps(n) { return n + this.k; } @undone drops(n) { return n + this.k; } }
let eight = new Eight(); show("eight", () => { let s = 0; for (let i = 0; i < 100; i++) s += eight.keeps(i & 3) * 10 + eight.drops(i & 1); return s; });
eight.keeps = n => n * 3; show("eight own", () => { let s = 0; for (let i = 0; i < 100; i++) s += eight.keeps(i & 3); return s; });
Object.setPrototypeOf(six, { m(n) { return n; }, q(n) { return n; } }); show("six relinked", () => { let s = 0; for (let i = 0; i < 100; i++) s += six.m(i & 3) + six.q(i & 1); return s; });
