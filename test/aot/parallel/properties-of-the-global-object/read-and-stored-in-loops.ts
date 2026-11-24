const xs: number[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => (k * 37) % 11).join() + "]");
const g: any = globalThis;
function show(name: string, run: () => unknown): void {
  const said: string[] = [];
  for (let round = 0; round < 3; round++) {
    try {
      said.push(String(run()));
    } catch (error) {
      said.push(error instanceof Error ? error.name : String(error));
    }
  }
  console.log(name, said.join(" "));
}

function stored() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).box1 = xs[i]; s = (s + xs[i]!) | 0; } return s + "," + g.box1; }
g.box2 = 3;
function read() { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + (globalThis as any).box2 + xs[i]!) | 0; return s; }
function both() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).box3 = xs[i]! * 2; s = (s + (globalThis as any).box3) | 0; } return s + "," + g.box3; }
g.count4 = 0;
function counted() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).count4 += xs[i]!; s = (s + xs[i]!) | 0; } return s + "," + g.count4; }
function absent() { let s = 0; for (let i = 0; i < xs.length; i++) { if ((globalThis as any).missing5) s += 1000; s = (s + xs[i]!) | 0; if (i === 30 && s % 2) g.missing5 = true; } const said = s + "," + g.missing5; delete g.missing5; return said; }
g.box6 = 1;
function kindChanges() { let s: any = 0; g.box6 = 1; for (let i = 0; i < xs.length; i++) { if (i === 20) g.box6 = "x"; s += (globalThis as any).box6; } return s; }
g.box7 = 5;
function deleted() { g.box7 = 5; let s = ""; for (let i = 0; i < 12; i++) { s += (globalThis as any).box7; if (i === 5) delete g.box7; } return s; }
let asked = 0;
function accessor() { g.box8 = 2; let s = 0; for (let i = 0; i < 12; i++) { s += (globalThis as any).box8; if (i === 5) Object.defineProperty(g, "box8", { configurable: true, get: () => ++asked * 100 }); } delete g.box8; return s; }
const laid: unknown[] = [];
function setter() {
  g.box9 = 2;
  for (let i = 0; i < 12; i++) { (globalThis as any).box9 = i; if (i === 5) Object.defineProperty(g, "box9", { configurable: true, get: () => 9, set: value => { laid.push(value); } }); }
  const said = laid.join() + "," + g.box9;
  delete g.box9;
  return said;
}
function readOnly() {
  g.box10 = 1;
  let s = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) Object.defineProperty(g, "box10", { configurable: true, writable: false, value: 77 });
    try { (globalThis as any).box10 = i; } catch (error) { s += (error as Error).name[0]; }
    s += g.box10;
  }
  delete g.box10;
  return s;
}
// The iteration restarts behind the store: it happens once.
g.box11 = 0;
const mixed: any[] = JSON.parse("[1,2,3,4,5,6,7,8,9,10]");
function restarted() {
  g.box11 = 0;
  mixed[6] = "six";
  let s: any = 0;
  for (let i = 0; i < mixed.length; i++) { (globalThis as any).box11 += 1; s = s + mixed[i]; }
  return s + "," + g.box11;
}
function thrown() {
  g.box12 = 0;
  let s = 0;
  for (let i = 0; i < mixed.length; i++) {
    (globalThis as any).box12 = i;
    if (i === 7) throw new RangeError("seven");
    s += xs[i]!;
  }
  return s;
}
function nested() { let s = 0; for (let r = 0; r < 4; r++) { (globalThis as any).row13 = r; for (let i = 0; i < 6; i++) { (globalThis as any).cell13 = i * r; s = (s + (globalThis as any).cell13 + (globalThis as any).row13) | 0; } } return s + "," + g.row13 + "," + g.cell13; }
function objects() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).box14 = { x: xs[i]!, i }; s = (s + (globalThis as any).box14.x) | 0; } return s + "," + JSON.stringify(g.box14); }
function conditional() { let s = 0; for (let i = 0; i < xs.length; i++) { if (xs[i]! > 5) (globalThis as any).last15 = xs[i]; else (globalThis as any).other15 = i; s = (s + xs[i]!) | 0; } return [s, g.last15, g.other15].join(); }
function throughCalls() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).box16 = i; touch(); s = (s + (globalThis as any).box16) | 0; } return s; }
function touch() { if (g.box16 % 5 === 0) g.box16 = 1000; }
function chained() { g.box17 = 1; let s = 0; for (let i = 0; i < 12; i++) { const was = (globalThis as any).box17; (globalThis as any).box17 = (was * 3 + xs[i]!) % 1009; s = (s + was) | 0; } return s + "," + g.box17; }
function listThere() { (globalThis as any).list18 = [1, 2, 3, 4]; let s = 0; for (let i = 0; i < (globalThis as any).list18.length; i++) s += (globalThis as any).list18[i]; return s; }
function functionThere() { (globalThis as any).helper19 = (x: number) => x + 1; let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + (globalThis as any).helper19(xs[i])) | 0; if (i === 20) (globalThis as any).helper19 = (x: number) => x * 100; } return s; }
function frozenObject() { const own: any = Object.freeze({ box: 1 }); let s = ""; for (let i = 0; i < 4; i++) { try { own.box = i; } catch { s += "t"; } } return s; }
function symbolKey() { const key = Symbol.for("kept20"); let s = 0; for (let i = 0; i < 10; i++) { (globalThis as any)[key] = i; s += (globalThis as any)[key]; } return s; }
function none() { (globalThis as any).box21 = 4; let s = 0; for (let i = 0; i < 0; i++) { (globalThis as any).box21 = i; s++; } return s + "," + g.box21; }
for (const [name, run] of Object.entries({ stored, read, both, counted, absent, kindChanges, deleted, accessor, setter, readOnly, restarted, thrown, nested, objects, conditional, throughCalls, chained, listThere, functionThere, frozenObject, symbolKey, none })) show(name, run);
console.log(g.box11, g.box12);

(globalThis as any).total22 = 0;
for (let round = 0; round < 3; round++) for (let i = 0; i < xs.length; i++) { (globalThis as any).total22 += xs[i]!; (globalThis as any).last22 = i; }
console.log(g.total22, g.last22, Object.keys(globalThis).filter(name => /\d\d?$/.test(name) && /^(box|count|row|cell|last|other|list|helper|total)/.test(name)).sort().join());
