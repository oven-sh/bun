// A getter, a method, a closure out of a list, a construction: whoever enters by value gets a boxed value, whoever enters the body directly the raw one.
// With no callee copied into its caller every call is a call, of the smallest function too.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function told(n) { report(n); report(n + 1); report(n * 2); report(n === n); report("" + n); report(typeof n); }
class Box { constructor(w, h) { this.w = w; this.h = h; } get area() { return this.w * this.h; } get isFlat() { return this.h === 0; } get label() { return this.h > 0 ? this.h : "flat"; } get bits() { return this.w | 0; } scaled(by) { return this.area * by; } isWiderThan(other) { return this.w > other.w; } static unit() { return 1; } }
class Cube extends Box { constructor(w, h, d) { super(w, h); this.d = d; } get area() { return super.area * this.d; } scaled(by) { return super.scaled(by) + 0.5; } }
const plain = { w: 2, get twice() { return this.w * 2; }, get isTwo() { return this.w === 2; }, thrice() { return this.w * 3; } };
function areaOf(box) { return box.area; }
function readBy(name, box) { return box[name]; }
function callBy(name, box, argument) { return box[name](argument); }
function half(n) { return n / 2; }
function bits(n) { return n | 0; }
function isBig(n) { return n > 100; }
function counted() { return arguments.length; }
function total(...all) { let sum = 0; for (let i = 0; i < all.length; i++) { sum += all[i]; } return sum; }
function withDefault(n = 4) { return n * 2; }
function Maker(n) { this.n = n; return n * 2; }
const table = [half, bits, isBig];
function fromTable(i, n) { return table[i](n); }
const arrow = n => n * 3;
const keeper = (function () { let kept = 1; return { grow() { kept = kept * 2; return kept; }, isOver(n) { return kept > n; } }; })();
const box = new Box(3, 4);
const flat = new Box(2.5, 0);
const cube = new Cube(3, 4, 5);
told(box.area);
told(flat.area);
told(cube.area);
told(box.isFlat);
told(flat.isFlat);
told(box.label);
told(flat.label);
told(flat.bits);
told(box.scaled(2));
told(cube.scaled(2));
told(box.isWiderThan(flat));
told(Box.unit());
told(plain.twice);
told(plain.isTwo);
told(plain.thrice());
told(areaOf(box));
told(areaOf(cube));
told(areaOf(plain));
told(areaOf({ area: "text" }));
told(readBy("area", box));
told(readBy("isFlat", flat));
told(readBy("twice", plain));
told(readBy("bits", flat));
told(callBy("scaled", box, 3));
told(callBy("scaled", cube, 3));
told(callBy("thrice", plain, 0));
told(fromTable(0, 9));
told(fromTable(1, 9.5));
told(fromTable(2, 9));
told(counted());
told(counted(1, 2, 3));
told(total());
told(total(1, 2.5, 3));
told(withDefault());
told(withDefault(1.5));
told(arrow(1.5));
told(keeper.grow());
told(keeper.grow());
told(keeper.isOver(3));
report(typeof new Maker(4));
report(new Maker(4).n);
report(typeof new half(4));
report(typeof new bits(4));
report("end");
