// a definition by a descriptor moves the field out of its slot: the look at the slot fails from then on, and the getter is called as often as the text calls it
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
let calls = 0;
function make(x, y) { return { x, y }; }
function read(p) { const { x, y, x: again } = p; return x * 100 + y * 10 + again; }
function has(p) { const x = "x" in p, y = "y" in p; return (x ? 1 : 0) + (y ? 2 : 0); }
function around(p, hook) { const { x, y } = p; hook(p); const { x: nextX, y: nextY } = p; return ((x * 10 + y) * 100 + nextX) * 100 + nextY; }
function hasAround(p, hook) { const x = "x" in p, y = "y" in p; hook(p); const nextX = "x" in p, nextY = "y" in p; return (x ? 1 : 0) + (y ? 2 : 0) + (nextX ? 10 : 0) + (nextY ? 20 : 0); }
function inLoop(p, hook, at) { let sum = 0; for (let i = 0;i < 5; i++) { const { x, y } = p; if (i === at) hook(p); const { x: nextX, y: nextY } = p; sum = sum * 3 + x + y * 2 + nextX * 5 + nextY * 7; } return sum; }
function overList(list, hook, at) { let sum = 0; for (let i = 0;i < list.length; i++) { const p = list[i]; const { x, y } = p; if (i === at) hook(list[(i + 1) % list.length]); const { x: nextX, y: nextY } = p; sum = sum * 3 + x + y * 2 + nextX * 5 + nextY * 7; } return sum; }
function readOfAny(p) { const { x, y, x: again } = p; return x * 100 + y * 10 + again; }
function hasOfAny(p) { const x = "x" in p, y = "y" in p; return (x ? 1 : 0) + (y ? 2 : 0); }
function aroundOfAny(p, hook) { const { x, y } = p; hook(p); const { x: nextX, y: nextY } = p; return ((x * 10 + y) * 100 + nextX) * 100 + nextY; }
function inLoopOfAny(p, hook, at) { let sum = 0; for (let i = 0;i < 5; i++) { const { x, y } = p; if (i === at) hook(p); const { x: nextX, y: nextY } = p; sum = sum * 3 + x + y * 2 + nextX * 5 + nextY * 7; } return sum; }
const nothing = (p) => { calls += 100; };
function list() { const made = [0]; made.x = 10; made.y = 20; return made; }
const change = (p) => { Object.defineProperty(p, "x", { get() { calls++; return 7; }, enumerable: true, configurable: true }); };
report(read(make(1, 2)));
report(has(make(1, 2)));
report(around(make(1, 2), nothing));
report(around(make(1, 2), change));
report(hasAround(make(1, 2), nothing));
report(hasAround(make(1, 2), change));
const later = make(3, 4);
report(read(later));
report(has(later));
change(later);
report(read(later));
report(has(later));
report(around(later, nothing));
report(inLoop(make(1, 2), nothing, 2));
report(inLoop(make(1, 2), change, 0));
report(inLoop(make(1, 2), change, 2));
report(inLoop(make(1, 2), change, 4));
report(overList([make(1, 2), make(3, 4), make(5, 6)], nothing, 0));
report(overList([make(1, 2), make(3, 4), make(5, 6)], change, 0));
report(overList([make(1, 2), make(3, 4), make(5, 6)], change, 2));
report(readOfAny(list()));
report(readOfAny(make(1, 2)));
report(hasOfAny(list()));
report(hasOfAny(make(1, 2)));
report(aroundOfAny(list(), nothing));
report(aroundOfAny(make(1, 2), nothing));
report(aroundOfAny(make(1, 2), change));
report(aroundOfAny(list(), change));
const laterOfAny = make(5, 6);
report(readOfAny(laterOfAny));
change(laterOfAny);
report(readOfAny(laterOfAny));
report(hasOfAny(laterOfAny));
report(inLoopOfAny(list(), nothing, 1));
report(inLoopOfAny(make(1, 2), nothing, 1));
report(inLoopOfAny(make(1, 2), change, 0));
report(inLoopOfAny(make(1, 2), change, 2));
report(inLoopOfAny(make(1, 2), change, 4));
report(inLoopOfAny(list(), change, 2));
report(calls);
class Cell { a; b; constructor(a, b) { this.a = a; this.b = b; } get flip() { Object.defineProperty(this, "a", { get() { calls++; return 1000; }, configurable: true }); return 5; } }
function through(c) { const { a, b, flip: flipped, a: nextA, b: nextB } = c; return a + b * 10 + flipped + nextA + nextB * 10; }
function throughInLoop(c, at) { let sum = 0; for (let i = 0;i < 4; i++) { const { a, b } = c, flipped = i === at ? c.flip : 0, { a: nextA, b: nextB } = c; sum = sum * 2 + a + b + flipped + nextA * 3 + nextB; } return sum; }
class Late { a; b; constructor(a, b) { this.a = a; this.b = b; } get flip() { Object.defineProperty(this, "a", { get() { calls++; return 1000; }, configurable: true }); return 5; } get flipLater() { if (this.b++ === 2) Object.defineProperty(this, "a", { get() { calls++; return 1000; }, configurable: true }); return 5; } }
function insideRun(c) { const { a, flip: flipped, a: nextA } = c, kind = !c; return a + " " + flipped + " " + nextA + " " + kind; }
function insideRunInLoop(c) { let sum = 0; for (let i = 0;i < 5; i++) { const { a, flipLater: flipped, a: nextA } = c, kind = !c; sum = sum * 2 + a + flipped + nextA * 3 + (kind ? 1 : 2); } return sum; }
report({ insideRun, insideRunInLoop });
report(insideRun(""));
report(insideRun(new Late(1, 2)));
report(insideRunInLoop(""));
report(insideRunInLoop(new Late(1, 0)));
report(insideRunInLoop(new Late(1, 2)));
report(insideRunInLoop(new Late(1, 9)));
report(through(new Cell(1, 2)));
report(throughInLoop(new Cell(1, 2), 1));
report(throughInLoop(new Cell(1, 2), 9));
const back = make(8, 9);
change(back);
Object.defineProperty(back, "x", { value: 11, writable: true, enumerable: true, configurable: true });
report(read(back));
report(readOfAny(back));
const fixed = make(8, 9);
Object.defineProperty(fixed, "x", { value: 12, writable: false, enumerable: true, configurable: true });
report(read(fixed));
report(inLoop(fixed, nothing, 1));
report(calls);
report("end");
