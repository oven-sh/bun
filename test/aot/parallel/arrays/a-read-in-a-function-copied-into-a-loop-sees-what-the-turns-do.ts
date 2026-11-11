// A small function that reads one element is copied into the loop that calls it, and the list that it is handed is tested once in front of the loop. What the turns do to the list must still be seen by the read.
declare const console: { log(...values: unknown[]): void };
function at(list: number[], i: number): number { return list[i]; }
function step(list: number[], i: number): number { return at(list, i) + 1; }
function first(list: number[]): number { return list[0]; }
function under(list: any, key: any): unknown { return list[key]; }
function sum(list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += step(list, i); return s; }
function sumOfFirst(list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += first(list); return s; }
function sumWhileItChanges(list: any[], n: number, when: number, deed: (list: any[]) => void): string { let s = ""; for (let i = 0; i < n; i++) { if (i === when) deed(list); s += at(list, i) + ","; } return s; }
function sumUnder(list: any, keys: unknown[]): string { let s = ""; for (let i = 0; i < keys.length; i++) s += String(under(list, keys[i])) + ","; return s; }
const whole = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 3); return list; };
const halves = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i + 0.5); return list; };
for (let round = 0; round < 3; round++) {
    console.log(sum(whole(), 8), sum(whole(), 10), sum(halves(), 8), sum([], 3), sum([1, , 3] as number[], 3), sumOfFirst(whole(), 4), sumOfFirst([], 2), sumOfFirst(halves(), 3));
    console.log(sum(["a", "b"] as unknown as number[], 2), sum(new Array(4), 4), sum(Object.freeze(whole()) as number[], 8));
}
const deeds: Record<string, (list: any[]) => void> = {
    "stores a fraction": list => { list[5] = 0.25; }, "stores a word": list => { list[5] = "w"; }, "cuts": list => { list.length = 4; }, "grows": list => { for (let i = 0; i < 40; i++) list.push(-i); },
    "deletes": list => { delete list[5]; }, "lays a getter": list => { Object.defineProperty(list, 6, { get() { return "got"; }, configurable: true }); }, "stores far away": list => { list[100000] = 1; },
    "takes another prototype": list => { Object.setPrototypeOf(list, { __proto__: Array.prototype, 9: "above" }); }, "shifts": list => { list.shift(); }, "reverses": list => { list.reverse(); }, "fills": list => { list.fill("f", 2, 6); }, "freezes": list => { Object.freeze(list); },
};
for (const name in deeds) for (const when of [0, 3, 7]) console.log(name + " at " + when + ": " + sumWhileItChanges(whole(), 10, when, deeds[name]) + " | " + sumWhileItChanges(halves(), 10, when, deeds[name]));
console.log(sumUnder(whole(), [0, 7, 8, -1, 1.5, "2", "length", "push".length, NaN, undefined, null, "at"].map(key => (typeof key === "string" && key === "at" ? "x" : key))));
function whileAFractionIsStored(list: number[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i === when) list[5] = 0.25; s += at(list, i) + ","; } return s; }
function whileAWordIsStored(list: any[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i === when) list[5] = "w"; s += at(list, i) + ","; } return s; }
function whileItIsCut(list: number[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i === when) list.length = 4; s += at(list, i) + ","; } return s; }
function whileItGrows(list: number[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i >= when) list.push(-i); s += at(list, i) + ","; } return s; }
function whileOneIsDeleted(list: number[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i === when) delete list[5]; s += at(list, i) + ","; } return s; }
function whileItIsStoredFarAway(list: number[], when: number): string { let s = ""; for (let i = 0; i < 10; i++) { if (i === when) list[100000] = 1; s += at(list, i) + ","; } return s; }
function whileEachIsStoredBack(list: number[]): string { let s = ""; for (let i = 0; i < 10; i++) { list[i] = step(list, i); s += at(list, i) + ","; } return s; }
function quietly(list: number[]): string { let s = ""; for (let i = 0; i < 10; i++) s += step(list, i) + ","; return s; }
for (const make of [whole, halves]) for (const when of [0, 3, 7, 99])
    console.log(when + ": " + whileAFractionIsStored(make(), when) + " | " + whileAWordIsStored(make(), when) + " | " + whileItIsCut(make(), when) + " | " + whileItGrows(make(), when) + " | " + whileOneIsDeleted(make(), when) + " | " + whileItIsStoredFarAway(make(), when));
console.log(whileEachIsStoredBack(whole()), whileEachIsStoredBack(halves()), quietly(whole()), quietly(halves()), quietly([1, , 3] as number[]), quietly([]));
const marksOfQuietly = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
const marksOfWhileItIsCut = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
const marksOfWhileItGrows = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
const marksOfWhileOneIsDeleted = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
const marksOfWhileEachIsStoredBack = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
const marksOfWhileTheNextIsStored = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 5 + 1); return list; };
function pick(list: number[], i: number): number { return list[i]; }
function pickAndAdd(list: number[], i: number): number { return pick(list, i) + 1; }
function countQuietly(list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += (pick(list, i) | 0) * (i + 1); return s; }
function countWhileItIsCut(list: number[], n: number, when: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i === when) list.length = 4; s += (pick(list, i) | 0) * (i + 1); } return s; }
function countWhileItGrows(list: number[], n: number, when: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i >= when) list.push(i); s += (pick(list, i) | 0) * (i + 1); } return s; }
function countWhileOneIsDeleted(list: number[], n: number, when: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i === when) delete list[5]; s += (pick(list, i) | 0) * (i + 1); } return s; }
function countWhileEachIsStoredBack(list: number[], n: number): number { let s = 0; for (let i = 0; i < n - 2; i++) { list[i] = pickAndAdd(list, i); s += (pick(list, i) | 0) * (i + 1); } return s; }
function countWhileTheNextIsStored(list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) { list[i + 1] = pick(list, i) + 2; s += (pick(list, i + 1) | 0) * (i + 1); } return s; }
for (const n of [10, 9, 40]) for (const when of [0, 3, 7, 99]) console.log(n, when, countQuietly(marksOfQuietly(), n), countWhileItIsCut(marksOfWhileItIsCut(), n, when), countWhileItGrows(marksOfWhileItGrows(), n, when), countWhileOneIsDeleted(marksOfWhileOneIsDeleted(), n, when), countWhileEachIsStoredBack(marksOfWhileEachIsStoredBack(), n), countWhileTheNextIsStored(marksOfWhileTheNextIsStored(), n));
class Scale { factor: number; constructor(factor: number) { this.factor = factor; } at(list: number[], i: number): number { return list[i] * this.factor; } second(i: number, list: number[]): number { return list[i] + this.factor; } }
const grains = () => { const list: number[] = []; for (let i = 0; i < 8; i++) list.push(i * 7 + 2); return list; };
function sumByAMethod(scale: Scale, list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += scale.at(list, i) | 0; return s; }
function sumByAMethodThatTakesTheListLast(scale: Scale, list: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += scale.second(i, list) | 0; return s; }
function sumByAFunctionThatHoldsAName(list: number[], n: number, shift: number): number { const shifted = (from: number[], i: number): number => from[i] + shift; let s = 0; for (let i = 0; i < n; i++) s += shifted(list, i) | 0; return s; }
for (const n of [8, 10, 3]) console.log(n, sumByAMethod(new Scale(3), grains(), n), sumByAMethodThatTakesTheListLast(new Scale(5), grains(), n), sumByAFunctionThatHoldsAName(grains(), n, n));
