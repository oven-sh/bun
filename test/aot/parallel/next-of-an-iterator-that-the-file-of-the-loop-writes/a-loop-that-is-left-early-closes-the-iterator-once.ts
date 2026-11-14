// The literal that the method returns holds a `return` beside `next`. A break, a return out of the function and a throw in the body of the loop each close the iterator once; running to the end does not.
const log: string[] = [];
class Shelf { [Symbol.iterator]() { let at = 0; return { next: () => (at < 6 ? { done: false, value: at++ } : { done: true, value: undefined }), return() { log.push("closed at " + at); return { done: true, value: undefined }; } }; } }
function firstOver(given: Shelf, limit: number, turns: number): number { let found = -1; for (let turn = 0; turn < turns; turn++) for (const item of given) { if ((item as number) > limit) { found = item as number; break; } } return found; }
function leaves(given: Shelf, limit: number, turns: number): number { for (let turn = 0; turn < turns; turn++) for (const item of given) if ((item as number) > limit + turn) return item as number; return -1; }
function throws(given: Shelf, limit: number, turns: number): string { let said = ""; for (let turn = 0; turn < turns; turn++) { try { for (const item of given) if ((item as number) > limit) throw new RangeError("over at " + item); } catch (error) { said += String(error) + ";"; } } return said; }
function firstTwo(given: Shelf, turns: number): number { let sum = 0; for (let turn = 0; turn < turns; turn++) { const [a, b] = given; sum += (a as number) + (b as number); } return sum; }
(globalThis as any).keep = [firstOver, leaves, throws, firstTwo, new Shelf()];
const limit = Number(process.argv[2] ?? 2);
console.log(firstOver(new Shelf(), limit, 3), firstOver(new Shelf(), 9, 2), leaves(new Shelf(), limit, 3), throws(new Shelf(), limit, 2), firstTwo(new Shelf(), 3));
console.log(log.join(" | "));
