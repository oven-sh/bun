// STATISTIC: ExactIntegersBehindNumbers >= 1
function byIndex(xs: number[]): number { let s = 5; for (let i = 0; i < xs.length; i++) s = (s + xs[i]) | 0; return s; }
function forOf(xs: number[]): number { let s = 5; for (const x of xs) s = (s + x) | 0; return s; }
const base = (): number[] => { const l: number[] = []; for (let i = 0; i < 20; i++) l.push(i + 1); return l; };
for (const odd of [0.5, -0.5, 1e10, -1e10, 4294967296.5, NaN, Infinity, -Infinity, -0, 2147483648, -2147483649]) for (const at of [0, 3, 8, 19]) {
  const l = base(); l[at] = odd; console.log(odd, at, byIndex(l), forOf(l));
}
