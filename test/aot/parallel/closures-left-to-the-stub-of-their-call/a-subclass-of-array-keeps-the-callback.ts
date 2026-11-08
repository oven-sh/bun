function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Step = (x: number) => number;
const every = new Set<Step>();
let last: Step | undefined;
class Pile extends Array<number> { map(f: any): any { last = f; every.add(f); return super.map(f); } }
class Plain extends Array<number> { }
function scaled(list: number[], k: number): number { const made = list.map(x => x * k); return made.length + made[0]; }

const pile = Pile.from([1, 2, 3]) as Pile;
const plain = Plain.from([4, 5]) as Plain;
let all = 0;
for (let i = 0; i < 300; i++) all += scaled(i % 3 === 0 ? pile : i % 3 === 1 ? plain : [6, 7], i);
settle();
const order = [...every];
console.log(all, every.size, every.has(last!), order.indexOf(last!), order[0] === order[1], last!(3), order[0](3), order[50](2));
console.log(every.delete(last!), every.delete(last!), every.size, scaled(pile, 5), every.size, last!(1));
