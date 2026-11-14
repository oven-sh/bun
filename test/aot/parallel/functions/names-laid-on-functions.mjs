// Names laid on functions hold what is laid on them wherever it is laid, and nothing before.
function Vector(x, y) { this.x = x; this.y = y; }
const early = [Vector.limit, typeof Vector.dot];
Vector.limit = 7;
Vector.dot = function (a, b) { return a.x * b.x + a.y * b.y; };
Vector.zero = new Vector(0, 0);
function Numbers() {}
function readNumbers(n) { let t = 0; for (let i = 0; i < n; i++) t += Numbers.whole * i + Numbers.part - (Numbers.late ?? 0.25) + Numbers.scale(i); return t; }
Numbers.scale = x => x * 2;
console.log(Object.is(readNumbers(3), NaN));
Numbers.whole = 3; Numbers.part = 0.5;
console.log(readNumbers(4));
Numbers.whole = 2 ** 40; Numbers.part = -0; Numbers.late = 9;
console.log(readNumbers(5), Object.is(Numbers.part, -0));
Numbers.scale = x => x - 0.125;
console.log(readNumbers(6), readNumbers(0));
Numbers.late = undefined; Numbers.whole = NaN;
console.log(readNumbers(2), [Numbers.whole, Numbers.part, Numbers.late].join());
function Settings() {}
const box = { math: {} }; box.math.Settings = Settings;
(function () { const S = box.math.Settings; S.slop = 0.005; S.pi = Math.PI; S.double = S.slop * 2; S.mix = function (a, b) { return Math.sqrt(a * b); }; })();
function use(n) { let t = 0; const a = new Vector(1, 2), b = new Vector(3, 4); for (let i = 0; i < n; i++) t += Vector.limit * i - Vector.dot(a, b) + Settings.slop + Settings.mix(i, 4) + Vector.zero.x; return t; }
console.log(early.join(), use(20), use(0), Settings.double);
Vector.limit = "8";
console.log(use(3));
Vector.limit = 2.5; Vector.dot = (a, b) => a.x; Vector.zero = { x: "z" };
console.log(use(3));
delete Vector.limit;
console.log(use(2), "limit" in Vector, Object.keys(Vector).join());
Object.defineProperty(Settings, "slop", { get() { return 100; }, configurable: true });
console.log(use(2));
Vector.limit = 1n;
try { use(2); } catch (e) { console.log(e.constructor.name); }
Vector.limit = { valueOf() { return 3; } };
console.log(use(2));
Vector.dot = null;
try { use(1); } catch (e) { console.log(e.constructor.name); }
Vector.dot = undefined; Object.setPrototypeOf(Vector, { dot() { return 5; }, __proto__: Function.prototype });
try { use(1); } catch (e) { console.log(e.constructor.name); }
delete Vector.dot;
console.log(use(1), Object.hasOwn(Vector, "dot"));
for (const key of ["slop", "pi"]) Object.defineProperty(Settings, key, { value: key, configurable: true, writable: true });
console.log(use(1), Settings.pi, Settings.pi * 2);
const copy = function make() { return function () { return copy.name2 ?? "none"; }; }();
console.log(copy(), (copy.name2 = 4, copy()), (copy.name2 = null, copy()));
