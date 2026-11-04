// each turn makes a text, so the collector runs many times in the loop, and nothing but the loop holds the list: its storage is read through a pointer from in front of the loop, so the list has to stay alive to the last turn
function count(names: string[], turns: number): number { let n = 0; let last = ""; for (let i = 0; i < turns; i++) { last = "n" + i; n += names[i & 7] ? 1 : 0; } return n + last.length; }
function sum(list: number[], turns: number): number { let s = 0; let last = ""; for (let i = 0; i < turns; i++) { last = "n" + i; s += list[i & 7]; } return s + last.length; }
(globalThis as any).kept = [count, sum];
const texts = (globalThis as any).kept[0] as typeof count;
const numbers = (globalThis as any).kept[1] as typeof sum;
function freshTexts(seed: number): string[] { return JSON.parse("[\"a" + seed + "\",\"\",\"c" + seed + "\",\"d\",\"\",\"f\",\"g\",\"h" + seed + "\"]"); }
function freshNumbers(seed: number): number[] { return JSON.parse("[" + seed + ",1.5,2,3,4,5,6,7]"); }
console.log(String(texts(freshTexts(0), 10)));
console.log(String(numbers(freshNumbers(0), 10)));
let all = 0;
for (let turn = 0; turn < 20; turn++) all += texts(freshTexts(turn), 300000) + numbers(freshNumbers(turn), 300000);
console.log(String(all));
