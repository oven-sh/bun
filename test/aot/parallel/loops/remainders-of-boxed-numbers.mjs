// Remainders of elements as keys: int32s of either sign, -0, undefined, doubles past 2 ** 31, fractions, holes.
// STATISTIC: RemaindersOfBoxes >= 3
const show = x => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : x && typeof x === "object" ? "{" + Object.keys(x).map(k => k + ":" + show(x[k])).join() + "}" : String(x);
const numbers = Array.from({ length: 20 }, (_, i) => (i * 37) % 101), gaps = [3, , 8, undefined, 2147483647, 0, 7], signs = [-5, -0, 5, -2147483648, 4294967295, 12], wide = [9007199254740991, 2147483648, 6, -4503599627370497];
const countNumbers = () => numbers.reduce((m, x) => { m[x % 5] = (m[x % 5] || 0) + 1; return m; }, {});
const countGaps = () => gaps.reduce((m, x) => { m[x % 5] = (m[x % 5] || 0) + 1; return m; }, {});
const countSigns = () => signs.reduce((m, x) => { m[x % 5] = (m[x % 5] || 0) + 1; return m; }, {});
const countWide = () => wide.reduce((m, x) => { m[x % 5] = (m[x % 5] || 0) + 1; return m; }, {});
const splitNumbers = () => { const q = [[], []]; for (const x of numbers) q[x % 2].push(x); return q; };
const splitGaps = () => { const q = [[], []]; for (const x of gaps) q[x % 2]?.push(x); return q; };
const splitSigns = () => { const q = [[], [], []]; for (let i = 0; i < signs.length; i++) q[signs[i] % 3]?.push(i); return q; };
const pushedNumbers = () => { const l = []; for (const x of numbers) l.push(x % 10); return l; };
const pushedGaps = () => { const l = []; for (const x of gaps) l.push(x % 10); return l; };
const pushedSigns = () => { const l = []; for (const x of signs) l.push(x % 10); return l; };
const pushedWide = () => { const l = []; for (const x of wide) l.push(x % 2147483647); return l; };
for (let turn = 0; turn < 3; turn++)
  console.log([countNumbers, countGaps, countSigns, countWide, splitNumbers, splitGaps, splitSigns, pushedNumbers, pushedGaps, pushedSigns, pushedWide].map(f => show(f())).join(" "));
function count(list) { return list.reduce((m, x) => { m[x % 5] = (m[x % 5] || 0) + 1; return m; }, {}); }
function store(list) { const l = [9, 9, 9, 9, 9, 9, 9, 9]; for (let i = 0; i < list.length; i++) l[list[i] % 8] = i; return l; }
for (const list of [numbers, numbers.map(x => -x), numbers.map(x => x / 4), [1, , 3, -0, 2 ** 53, -(2 ** 60), 1e300, Infinity, NaN], []]) console.log(show(count(list)), show(store(list)));
