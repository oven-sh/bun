// Loops over arrays in variables of a module, some of which only some iterations store into or read: the variables hold arrays of every storage, texts, views, nothing before they are initialized.
function shown(value: any): string { const x: any = value; return Array.isArray(value) || ArrayBuffer.isView(value) ? `[${x.length}:${Array.from({ length: Math.min(x.length, 9) }, (_: unknown, i: number) => (i in x ? leaf(x[i]) : "hole")).join(",")}]` : leaf(x); }
function leaf(x: any): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
function early() { let s: any = 0; for (let i = 0; i < 4; i++) if (i > 2) late[i] = 1; return s; }
try { early(); console.log("early: no error"); } catch (e: any) { console.log("early:", e.constructor.name); }
const late = [1, 2, 3, 4, 5, 6, 7, 8];
early();
const ints: number[] = JSON.parse("[3,-1,4,-1,5,-9,2,6]"), target: any[] = new Array(8).fill(0), doubles = [1.5, -2.5, 3, -4, 5.5, -6, 7, 8], holes: any[] = [1, , -3, 4, , 6, -7, 8];
const texts: any[] = ["a", "b", -1, 2, "c", -3, 4, 5], views = Float64Array.from([1.5, -2, 3, -4, 5, -6, 7, 8]), frozen: any = Object.freeze([1, -2, 3, -4, 5, -6, 7, 8]), short = [1, 2, 3];
let changing = [1, -2, 3, -4, 5, -6, 7, 8];
function clear() { let s: any = 0; for (let i = 0; i < ints.length; i++) { const x = ints[i]; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms() { let s: any = 0; for (let i = 0; i < doubles.length; i++) { const x = doubles[i]; if (x < 0) target[i] = 0; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function read() { let s: any = 0; for (let i = 0; i < ints.length; i++) if (ints[i] > 0) s += doubles[i]; return s; }
function both() { let s: any = 0; for (let i = 0; i < 8; i++) { if (ints[i] > 0) s += holes[i]; else late[i] = s; } return s; }
function intoTexts() { let s: any = 0; for (let i = 0; i < 8; i++) { if (ints[i] < 0) texts[i] = i; s += texts[i]; } return s; }
function intoView() { let s: any = 0; for (let i = 0; i < 8; i++) { if (doubles[i] < 0) views[i] = i / 4; s += views[i]; } return s; }
function intoFrozen() { let s: any = 0; for (let i = 0; i < 8; i++) { if (ints[i] === 6) frozen[i] = 1; s += frozen[i]; } return s; }
function intoShort() { let s: any = 0; for (let i = 0; i < 8; i++) { if (ints[i] > 3) short[i] = i; s += short[i] ?? 0.5; } return s; }
function change() { let s: any = 0; for (let i = 0; i < 8; i++) { if (ints[i] < 0) changing[i] = 0; else if (i === 4) changing = doubles; s += changing[i]; } return s; }
function nest() { let s: any = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < 8; i++) { if (ints[i] < k) late[i] = k; s += late[i] * 2; } return s; }
function kept() { let s: any = 0; for (let i = 0; i < 8; i++) { const x = late[i]; if (x > 2) target[i] = x; if (x < 2) target[i] = "t"; s += x; } return s; }
for (let round = 0; round < 3; round++) {
  for (const run of [clear, arms, read, both, intoTexts, intoView, intoFrozen, intoShort, change, nest, kept]) {
    let answer: string;
    try { answer = shown(run()); } catch (e: any) { answer = e.constructor.name; }
    console.log(run.name, answer, [ints, target, doubles, holes, texts, views, frozen, short, changing, late].map(shown).join(""));
  }
  if (round === 0) ints[2] = 4.5; else (ints as any)[5] = "nine";
}
export {};
