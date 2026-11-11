// Rows of whole numbers and rows of fractions, each kind born at a place of its own, are multiplied pair by pair: the turns laid out meet every mixture of kinds.
export {};
const width: number = JSON.parse("48");
function wholes(w: number, r: number): number[] { const l: number[] = []; for (let i = 0; i < w; i++) l.push((i * 3 + r) % 11); return l; }
function fractions(w: number, r: number): number[] { const l: number[] = []; for (let i = 0; i < w; i++) l.push(((i * 3 + r) % 11) / 4 + 0.25); return l; }
function rows(w: number): number[][] { const out: number[][] = []; for (let r = 0; r < 8; r++) out.push((r & 1) ? wholes(w, r) : fractions(w, r)); return out; }
function go(m: number[][], w: number): number { let s = 0; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) for (let k = 0; k < w; k++) s += m[i]![k]! * m[j]![k]!; return s; }
const m0 = rows(width);
function f(t: number): number { return Math.floor(go(m0, width)) + (t & 1); }
const N = 3; let sum = 0; for (let t = 0; t < N; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
