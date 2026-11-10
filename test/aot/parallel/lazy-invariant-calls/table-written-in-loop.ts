// The loop stores into the table that it reads, under the same key or through another name: every iteration looks up anew.
// STATISTIC: ResultsCarriedAroundLoops = 0
const list: number[] = JSON.parse("[1,2,3,4]");
function sum(list: number[], read: Map<string, number>, written: Map<string, number>, q: string, stop: number): number { let s = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; s = s * 10 + (read.get(q) ?? 9); written.set(q, list[i]); } return s; }
(globalThis as any).kept = sum;
const one = new Map([["a", 7]]);
console.log(sum(list, one, one, "a", 0), sum(list, new Map([["a", 7]]), new Map(), "a", 0), sum(list, new Map(), new Map(), "a", 3));
