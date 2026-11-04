type Point = { x: number; y: number; z: number };
const make = (n: number): Point => ({ x: n, y: n + 1, z: n + 2 });
function firstOver(p: Point, limit: number): string { for (const name in p) { if (p[name as keyof Point] > limit) return name; } return "none"; }
function untilY(p: Point): number { let s = 0; for (const name in p) { if (name === "y") break; s += p[name as keyof Point]; } return s; }
function skipsY(p: Point): number { let s = 0; for (const name in p) { if (name === "y") continue; s += p[name as keyof Point]; } return s; }
function lastName(p: Point): string { let last = "-"; for (const name in p) last = name; return last; }
function varName(p: Point): string { for (var name in p) { } return String(name!); }
function throwsAt(p: Point): number { let s = 0; for (const name in p) { if (p[name as keyof Point] > 3) throw new RangeError(name); s += 1; } return s; }
function catchesInside(p: Point): number { let s = 0; for (const name in p) { try { if (name === "y") throw 1; s += p[name as keyof Point]; } catch { s += 100; } } return s; }
function makers(p: Point): (() => string)[] { const made: (() => string)[] = []; for (const name in p) made.push(() => name + p[name as keyof Point]); return made; }
function nested(p: Point, q: Point): string { let s = ""; for (const a in p) for (const b in q) s += a + b; return s; }
function twice(p: Point): string { let s = ""; for (const a in p) s += a; for (const b in p) s += p[b as keyof Point]; return s; }
function hasOwnAsked(p: Point): number { let s = 0; for (const name in p) { if (Object.prototype.hasOwnProperty.call(p, name) && name in p) s += p[name as keyof Point]; } return s; }
function copies(p: Point): string { const out: any = {}; for (const name in p) out[name] = p[name as keyof Point] * 2; return JSON.stringify(out); }
for (let i = 0; i < 3; i++) {
  console.log(firstOver(make(i), 2), firstOver(make(i), 9), untilY(make(i)), skipsY(make(i)), lastName(make(i)), varName(make(i)), catchesInside(make(i)), makers(make(i)).map(f => f()).join(), nested(make(i), make(1)), twice(make(i)), hasOwnAsked(make(i)), copies(make(i)));
  try { console.log(throwsAt(make(i))); } catch (error) { console.log((error as Error).message); }
}
