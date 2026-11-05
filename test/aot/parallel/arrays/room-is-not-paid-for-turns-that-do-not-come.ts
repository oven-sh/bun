// A list gets the room that a loop will fill only where nothing but the end of the count ends the loop and nothing in the turns takes an element away again: else a list of three elements would hold the room of the whole bound.
declare const console: { log(...values: unknown[]): void };
declare const process: undefined | { memoryUsage(): { rss: number } };
const held = () => (typeof process === "object" && process ? process.memoryUsage().rss / 1048576 : 0);
function putAndTake(list: number[], most: number): number { let seen = 0; for (let i = 0; i < most; i++) { list[list.length] = i; seen = (seen + (list.pop()! & 1)) | 0; } return seen; }
function next(i: number): number { if (i === 3) throw new RangeError("at " + i); return i; }
function fillByCalls(list: number[], most: number): string { try { for (let i = 0; i < most; i++) list[i] = next(i); } catch (error) { return (error as Error).message; } return "filled"; }
function fillOffAnObject(list: unknown[], most: number, holders: ({ word: string } | undefined)[]): string { try { for (let i = 0; i < most; i++) list[i] = holders[i & 3]!.word; } catch (error) { return (error as Error).name; } return "filled"; }
function fillAndCut(list: number[], most: number): number { for (let i = 0; i < most; i++) { list[list.length] = i; if (list.length > 2) list.length = 0; } return list.length; }
const kept: unknown[][] = [];
const before = held();
for (const most of [20000000, 250000000]) {
    const first: number[] = [], second: number[] = [], third: unknown[] = [];
    kept.push(first, second, third);
    console.log(fillByCalls(second, most), second.length, fillOffAnObject(third, most, [{ word: "a" }, { word: "b" }, undefined, { word: "d" }]), third.length);
    if (most < 100000000) { const fourth: number[] = []; kept.push(fourth); console.log(putAndTake(first, most), first.length, fillAndCut(fourth, most), fourth.length); }
}
console.log(kept.length, held() - before < 100);
