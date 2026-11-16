// Lists of given lengths and empty lists with room, born before and after a prototype with an indexed accessor has come into being.
declare const Bun: any;
const words: string[] = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon".split(" ");
const kept: any[][] = [];
function look(t: any[]): string { const n = t.length; let s = n + (n in t ? "!" : "") + String(t[n]) + String(t.at(-1)) + Object.keys(t).length; t.push("p", 1.5); t[t.length] = undefined; s += t.length + String(t[n]) + String(t[n + 1]); t.length = n; return s; }
function hash(s: string): number { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003; return h; }
function births(): string {
  let s = "";
  for (let n = 0; n <= 24; n++) for (let i = 0; i < 40; i++) {
    const t = Array.from({ length: n }, (_, k) => k + i);
    const texts: string[] = []; for (let k = 0; k < n; k++) texts.push(words[(k + i) % 20]);
    const any = []; for (let k = 0; k < n; k++) any.push(k & 1 ? words[k % 20] : k);
    const made = [t.map(x => x + 1), t.map(x => x / 2), t.map(x => words[x % 20]), texts.map(x => x.length), t.filter(x => x & 1), texts.filter(x => x.length > 2), t.slice(), texts.slice(1), any.slice(0, 3), new Array(n), new Array(n).fill(0.5), texts.join(",").split(","), [...t], [...texts, 1], any.concat(t), any];
    if (i % 13 === 0) for (const r of made) { s += look(r); if (n % 5 === 0) kept.push(r); }
    else for (const r of made) s += r.length;
  }
  return hash(s) + ":" + s.length;
}
console.log(births());
console.log(births());
let sets = 0;
const odd: any = { get 3() { return "three"; }, set 3(v) { sets++; } };
const below = Object.create(odd);
below[3] = 1;
console.log(sets, below[3], Object.keys(below).length);
console.log(births());
class Strange extends Array<any> {}
Object.setPrototypeOf(Strange.prototype, Object.create(Array.prototype, { 5: { get() { return "five"; }, set(v) { sets += 10; }, configurable: true } }));
const strange = new Strange();
for (let i = 0; i < 8; i++) strange[i] = i;
console.log(sets, strange.length, strange[5], Object.keys(strange).join());
console.log(births());
if (typeof Bun === "object") Bun.gc(true);
let all = "";
for (const t of kept) all += t.length + ":" + t.map(x => String(x)).join();
console.log(kept.length, hash(all));
