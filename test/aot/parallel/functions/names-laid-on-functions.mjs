// Names laid on functions hold what is laid on them wherever it is laid, and nothing before.
function Spot(x, y) { this.x = x; this.y = y; }
const early = [Spot.most, typeof Spot.mixed];
Spot.most = 7;
Spot.mixed = function (a, b) { return a.x * b.y - a.y; };
Spot.origin = new Spot(0, 0);
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
function Scales() {}
const shop = { tools: {} }; shop.tools.Scales = Scales;
(function () { const S = shop.tools.Scales; S.grain = 0.375; S.turn = Math.E; S.double = S.grain * 2; S.blend = function (a, b) { return a + b / 4; }; })();
function use(n) { let t = 0; const a = new Spot(1, 2), b = new Spot(3, 4); for (let i = 0; i < n; i++) t += Spot.most * i - Spot.mixed(a, b) + Scales.grain + Scales.blend(i, 4) + Spot.origin.x; return t; }
console.log(early.join(), use(20), use(0), Scales.double);
Spot.most = "8";
console.log(use(3));
Spot.most = 2.5; Spot.mixed = (a, b) => a.x; Spot.origin = { x: "z" };
console.log(use(3));
delete Spot.most;
console.log(use(2), "most" in Spot, Object.keys(Spot).join());
Object.defineProperty(Scales, "grain", { get() { return 100; }, configurable: true });
console.log(use(2));
Spot.most = 1n;
try { use(2); } catch (e) { console.log(e.constructor.name); }
Spot.most = { valueOf() { return 3; } };
console.log(use(2));
Spot.mixed = null;
try { use(1); } catch (e) { console.log(e.constructor.name); }
Spot.mixed = undefined; Object.setPrototypeOf(Spot, { mixed() { return 5; }, __proto__: Function.prototype });
try { use(1); } catch (e) { console.log(e.constructor.name); }
delete Spot.mixed;
console.log(use(1), Object.hasOwn(Spot, "mixed"));
for (const key of ["grain", "turn"]) Object.defineProperty(Scales, key, { value: key, configurable: true, writable: true });
console.log(use(1), Scales.turn, Scales.turn * 2);
const copy = function make() { return function () { return copy.name2 ?? "none"; }; }();
console.log(copy(), (copy.name2 = 4, copy()), (copy.name2 = null, copy()));
