// Counters whose places are bits of a list's elements.
// STATISTIC: LoopsUnswitched >= 1
const parse = (text: string): number[] => JSON.parse(text);
const lists: [string, number[]][] = [["ints", parse("[1,2,3,4,5,6,7,8,9,10,11,12]")], ["doubles", parse("[1.5,2.25,-0,4,5,6,7,8.125,-9.75,1e300,11,12]")], ["texts", parse('[1,"2",3,null,5,true,7,8,9,10,11,12]')], ["short", parse("[1,2]")], ["large", parse("[2147483647,-2147483648,4294967296,-1,5,6,7,8,9,10,11,12]")]];
const holes = parse("[1,2,3,4,5,6,7,8,9,10,11,12]"); delete holes[3]; lists.push(["holes", holes]);
const counts = [0, 0, 0, 0]; const named: any = { a: 0, b: 0 }; const names = ["a", "b"]; const signs = new Int32Array(4);
function count(list: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = list[i]!; counts[x & 3]!++; s = (s + x) | 0; } return [s, counts].join(); }
function shifted(list: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = list[i]!; counts[(x >>> 1) & 3]! += x; s = (s + x) | 0; } return [s, counts].join(); }
function local(list: number[], n: number) { const held = new Array<number>(4).fill(0); for (let i = 0; i < n; i++) held[list[i]! & 3]!++; return held.join(); }
function both(list: number[], n: number) { for (let i = 0; i < n; i++) { const x = list[i]!; counts[x & 3] = counts[(x >> 2) & 3]! + 1; signs[x & 3]!++; } return [counts, signs].join(); }
function under(list: number[], n: number) { for (let i = 0; i < n; i++) named[names[list[i]! & 1]!] += list[i]!; return JSON.stringify(named); }
for (const [name, list] of lists) for (const f of [count, shifted, local, both, under]) for (const n of [list.length, 12]) {
  counts.fill(0); signs.fill(0); named.a = named.b = 0; let r: string; try { r = f(list, n); } catch (e: any) { r = "threw " + e.message; }
  console.log(name, f.name, n, r);
}
