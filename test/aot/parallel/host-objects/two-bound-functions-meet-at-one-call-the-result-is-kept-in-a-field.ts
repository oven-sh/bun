const at: number[] = JSON.parse("[0,1,0,1]");
const floor = Math.floor.bind(null);
const letter = String.fromCharCode.bind(null);
class Kept { held: number | string = 0; }
function call(pick: number): number | string { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; const f = pick ? letter : floor; return f(65.5); }
function fill(list: number[]): Kept[] { const all: Kept[] = []; for (let i = 0; i < list.length; i++) { const k = new Kept(); k.held = call(list[i]!); all.push(k); } return all; }
function show(all: Kept[]): string { let out = ""; for (let i = 0; i < all.length; i++) { const h = all[i]!.held; out += typeof h === "number" ? `n${h * 2},` : `t${h.length}${h},`; } return out; }
console.log(show(fill(at)));
