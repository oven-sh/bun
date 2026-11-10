// STATISTIC: ExactIntegersBehindNumbers >= 1
function byIndex(xs: number[]): number { let s = 5; for (let i = 0; i < xs.length; i++) s = (s + xs[i]) | 0; return s; }
function forOf(xs: number[]): number { let s = 5; for (const x of xs) s = (s + x) | 0; return s; }
function less(xs: number[]): number { let s = 5; for (let i = 0; i < xs.length; i++) s = (s - xs[i]) | 0; return s; }
function hash(xs: number[]): number { let h = 17; for (let i = 0; i < xs.length; i++) h = (Math.imul(h, 31) + xs[i]) | 0; return h; }
function unsigned(xs: number[]): number { let s = 5; for (let i = 0; i < xs.length; i++) s = (s + xs[i]) >>> 0; return s; }
const make = (n: number, hole: number): number[] => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i + 1); if (hole >= 0) delete l[hole]; return l; };
for (const f of [byIndex, forOf, less, hash, unsigned]) {
  const said: number[] = [];
  for (const n of [0, 1, 3, 7, 8, 9, 16, 17, 26]) for (const hole of [-1, 0, 1, 3, 7, 8, 15, 16, 25]) if (hole < n) said.push(f(make(n, hole)));
  console.log(f.name, said.join(" "));
}
const wide: number[] = []; for (let i = 0; i < 20; i++) wide.push(i & 1 ? 2147483647 : -2147483648);
console.log(byIndex(wide), forOf(wide), less(wide), hash(wide), unsigned(wide));
delete wide[19]; console.log(byIndex(wide), forOf(wide), less(wide), hash(wide), unsigned(wide));
delete wide[0]; console.log(byIndex(wide), forOf(wide), less(wide), hash(wide), unsigned(wide));
