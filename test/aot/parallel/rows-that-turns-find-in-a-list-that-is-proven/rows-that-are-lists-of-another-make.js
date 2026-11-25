// Frozen and sealed rows, a row with a name of its own, a row below another prototype, an arguments object, a proxy.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function asArguments() { return arguments; }
const below = Object.create([9.5, 8.5, 7.5, 6.5]);
const named = [1.5, 2.5, 3.5, 4.5]; named.extra = 1;
const other = [1.25, 2.25, 3.25, 4.25]; Object.setPrototypeOf(other, { 7: 70 });
let asked = 0;
const proxy = new Proxy([5.5, 6.5, 7.5, 8.5], { get(target, key) { asked++; return target[key]; } });
const odd = [Object.freeze([1.5, 2.5, 3.5, 4.5]), Object.seal([2.5, 3.5, 4.5, 5.5]), named, other, asArguments(0.5, 1.5, 2.5, 3.5), below, proxy];
const table = listOf(35, i => (i % 5 === 3 ? odd[(i - 3) / 5] : listOf(4, () => draw(20))));
function sums(table, a, b, count) { let sa = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + ab; }
for (const a of [0, 1, 3, 7]) console.log(a, sums(table, a, 2, table.length), asked);
