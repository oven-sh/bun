// STATISTIC: AssignedMemberChecks >= 10
// Methods that are replaced through an alias of the prototype or of the class, a parameter, a list of classes, a map, called before and after, inside loops.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e.name}: ${e.message}`; } console.log(label, r); };
class One { k = 1; m(n) { return n + this.k; } }
const one = new One(), prototypeOfOne = One.prototype;
show("one", () => { let s = 0; for (let i = 0; i < 100; i++) s += one.m(i & 3); return s; });
prototypeOfOne.m = function (n) { return n * 3 + this.k; };
show("one again", () => { let s = 0; for (let i = 0; i < 100; i++) s += one.m(i & 3); return s; });

class Two { k = 2; m(n) { return n + this.k; } }
function patchClass(C) { C.prototype.m = function (n) { return n * 5 + this.k; }; }
const two = new Two();
show("two", () => { let s = 0; for (let i = 0; i < 100; i++) s += two.m(i & 3); return s; });
patchClass(Two);
show("two again", () => { let s = 0; for (let i = 0; i < 100; i++) s += two.m(i & 3); return s; });

class Three { k = 3; m(n) { return n + this.k; } }
function patchPrototype(p) { p.m = function (n) { return n * 7 + this.k; }; }
const three = new Three();
patchPrototype(Three.prototype);
show("three", () => { let s = 0; for (let i = 0; i < 100; i++) s += three.m(i & 3); return s; });

class Four { k = 4; m(n) { return n + this.k; } }
class Five extends Four { w = 5; m(n) { return n - this.k; } }
function patchBoth(C) { C.prototype.m = function (n) { return n * 9 + this.k; }; }
const four = new Four(), five = new Five();
show("four", () => { let s = 0; for (let i = 0; i < 100; i++) s += four.m(i & 3) * 2 + five.m(i & 1); return s; });
patchBoth(Four);
show("four patched", () => { let s = 0; for (let i = 0; i < 100; i++) s += four.m(i & 3) * 2 + five.m(i & 1); return s; });
patchBoth(Five);
show("both patched", () => { let s = 0; for (let i = 0; i < 100; i++) s += four.m(i & 3) * 2 + five.m(i & 1); return s; });

class Six { k = 6; m(n) { return n + this.k; } }
const classes = new Map([["six", Six]]), six = new Six();
classes.get("six").prototype.m = function (n) { return n * 11 + this.k; };
show("six", () => { let s = 0; for (let i = 0; i < 100; i++) s += six.m(i & 3); return s; });

class Seven { k = 7; m(n) { return n + this.k; } }
function define(p) { Object.defineProperty(p, "m", { value: function (n) { return n * 13 + this.k; }, writable: true, configurable: true }); }
const seven = new Seven();
define(Seven.prototype);
show("seven", () => { let s = 0; for (let i = 0; i < 100; i++) s += seven.m(i & 3); return s; });
delete Seven.prototype.m;
show("seven gone", () => { let s = 0; for (let i = 0; i < 100; i++) s += seven.m(i & 3); return s; });
