type Point = { x: number; y: number; z: number };
const make = (n: number): Point => ({ x: n, y: n + 1, z: n + 2 });
function deletesLater(p: Point): string { let s = ""; for (const name in p) { s += name + p[name as keyof Point]; if (name === "x") delete (p as any).z; } return s; }
function deletesItself(p: Point): string { let s = ""; for (const name in p) { delete (p as any)[name]; s += name; } return s + Object.keys(p).length; }
function addsOne(p: Point): string { let s = ""; for (const name in p) { (p as any).w = 9; s += name + p[name as keyof Point]; } return s + Object.keys(p).join(); }
function deletesAndAddsAgain(p: Point): string { let s = ""; for (const name in p) { if (name === "x") { delete (p as any).y; (p as any).y = 7; } s += name + p[name as keyof Point]; } return s + Object.keys(p).join(); }
function storesInto(p: Point): string { let s = ""; for (const name in p) { p.z = p.z * 2; s += name + p[name as keyof Point]; } return s; }
function becomesGetter(p: Point): string { let s = ""; for (const name in p) { if (name === "x") Object.defineProperty(p, "y", { get() { return "got"; }, enumerable: true, configurable: true }); s += name + p[name as keyof Point]; } return s; }
function becomesHidden(p: Point): string { let s = ""; for (const name in p) { if (name === "x") Object.defineProperty(p, "y", { enumerable: false }); s += name; } return s; }
let changer: (p: Point) => void = () => {};
function callsOut(p: Point): string { let s = ""; for (const name in p) { changer(p); s += name + p[name as keyof Point]; } return s; }
function isReplaced(p: Point): string { let s = ""; for (const name in p) { s += name + p[name as keyof Point]; p = make(50); } return s; }
for (let i = 0; i < 3; i++) {
  console.log(deletesLater(make(i)), deletesItself(make(i)), addsOne(make(i)), deletesAndAddsAgain(make(i)), storesInto(make(i)), becomesGetter(make(i)), becomesHidden(make(i)), isReplaced(make(i)));
  console.log(callsOut(make(i)));
  changer = i === 0 ? p => { delete (p as any).y; } : p => { (p as any).extra = 1; };
}
