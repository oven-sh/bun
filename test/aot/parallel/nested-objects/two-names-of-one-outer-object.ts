// Two parameters name the same outer object. The inner object is read through both, held through one, and then read and stored through the other.
interface Inner { b: number; s: string }
interface Outer { a: Inner; n: number }
interface Box { f: Inner | null; g: Inner | null }
const lines: string[] = [];
function make(i: number): Outer { return { a: { b: i, s: "s" + i }, n: i }; }
function heldThroughTheFirst(x: Outer, y: Outer, box: Box): number { const c2 = y.a; const c1 = x.a; box.f = c2; return c1.b; }
function heldThroughTheSecond(x: Outer, y: Outer, box: Box): number { const c1 = x.a; const c2 = y.a; box.f = c2; return c1.b; }
function storedBehind(x: Outer, y: Outer, box: Box): number { const c2 = y.a; const c1 = x.a; box.f = c2; c1.b = 77; return box.f!.b; }
function comparedBehind(x: Outer, y: Outer, box: Box): boolean { const c2 = y.a; const c1 = x.a; box.f = c2; box.g = c1; return box.f === box.g; }
function inALoop(x: Outer, y: Outer, box: Box): number { let sum = 0; const c1 = x.a; for (let i = 0; i < 3; i++) { sum += c1.b; if (i === 1) box.f = y.a; c1.b += 1; } return sum * 1000 + box.f!.b; }
const kept: Outer[] = [];
for (let part = 0; part < 4; part++) for (let half = 0; half < 4; half++) for (let i = 0; i < 100; i++) kept.push(make(kept.length));
const box: Box = { f: null, g: null };
lines.push("held through the first " + heldThroughTheFirst(kept[5], kept[5], box) + " " + heldThroughTheFirst(kept[6], kept[7], box));
lines.push("held through the second " + heldThroughTheSecond(kept[8], kept[8], box) + " " + heldThroughTheSecond(kept[9], kept[10], box));
lines.push("stored behind " + storedBehind(kept[11], kept[11], box) + " " + kept[11].a.b + " " + storedBehind(kept[12], kept[13], box) + " " + kept[12].a.b);
lines.push("compared behind " + comparedBehind(kept[14], kept[14], box) + " " + comparedBehind(kept[15], kept[16], box));
lines.push("in a loop " + inALoop(kept[17], kept[17], box) + " " + inALoop(kept[18], kept[19], box));
let sum = 0;
for (let i = 0; i < kept.length; i++) sum += kept[i].a.b + kept[i].a.s.length;
lines.push("sum " + sum);
console.log(lines.join("\n"));
