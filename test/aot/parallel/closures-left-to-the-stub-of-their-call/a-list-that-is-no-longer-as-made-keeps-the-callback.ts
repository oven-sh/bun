function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Test = (x: number) => boolean;
const kept: Test[] = [];
function over(list: number[], k: number): number { const made = list.filter(x => x > k); return made.length + 1; }

const own: any = [1, 2, 3]; own.filter = function (this: number[], f: Test) { kept.push(f); return [f(this[0])]; };
const above: any = [4, 5, 6]; Object.setPrototypeOf(above, { __proto__: Array.prototype, filter(this: number[], f: Test) { kept.push(f); return Array.prototype.filter.call(this, f); } });
const tagged: any = [7, 8, 9]; tagged.tag = "tagged";
const sparse: number[] = [1, , 30] as number[];
const frozen = Object.freeze([10, 20, 30]) as number[];
const doubles = [1.5, 20.5];
const long: number[] = []; long[5000] = 9;
const lists: number[][] = [own, above, tagged, sparse, frozen, doubles, long, [], [11, 12]];
let all = 0;
for (let i = 0; i < 450; i++) all += over(lists[i % lists.length], i % 13);
settle();
console.log(all, kept.length, new Set(kept).size, kept[0] === kept[1], kept.indexOf(kept[70]), kept[0](1), kept[0](0), kept[99](100), kept[99](-1));
const late: any = [1, 2, 3];
all += over(late, 1);
late.filter = own.filter;
all += over(late, 1);
delete late.filter;
all += over(late, 1);
settle();
console.log(all, kept.length, kept[kept.length - 1](2), kept[kept.length - 1](1));
