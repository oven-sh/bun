// the loops only read. What is written as texts arrives with storage of doubles, of int32, undecided or sparse, and what is written as numbers arrives with storage for any value: the raw words of the one kind are no values of the other
function countTexts(list: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += typeof list[i] === "string" ? 100 : typeof list[i] === "number" ? 1 : 0; return n; }
function sum(list: number[]): string { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return String(s); }
(globalThis as any).kept = [countTexts, sum];
const texts = (globalThis as any).kept[0] as (list: unknown, turns: number) => number;
const numbers = (globalThis as any).kept[1] as (list: unknown) => string;
const lists: unknown[] = [JSON.parse("[\"a\",\"b\",\"c\"]"), JSON.parse("[1.5,2.5,3.5]"), JSON.parse("[1,2,3]"), JSON.parse("[]"), JSON.parse("[1,\"b\",2.5,null,{}]"), new Array(4)];
const sparse: unknown[] = ["a"];
sparse[500000] = "far";
console.log(String(texts(lists[0], 5)));
console.log(numbers(lists[2]));
let all = 0;
for (let turn = 0; turn < 600; turn++) all += texts(lists[turn % 6], 5) + numbers(lists[turn % 6]).length;
console.log(String(all));
for (let which = 0; which < 6; which++) console.log(String(texts(lists[which], 5)) + " " + numbers(lists[which]));
console.log(String(texts(sparse, 5)));
