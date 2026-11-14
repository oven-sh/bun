// answers: with-library
// # What lives into a landing pad is read there out of its slot. Each function here really throws out of a slow path (an operator on an object whose valueOf throws,
// # a getter that throws, a callback that throws, an iterator whose next throws) inside a for-of, a try, a finally or a generator that is closed,
// # and what catches reads a parameter, a value of a loop that changes in every turn, a value made once in front, and a fraction.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const bomb = { valueOf(): number { throw new Error("valueOf"); } };
const trap = { get field(): number { throw new RangeError("getter"); } };
let closed = 0;
function closing<T>(items: T[]): Iterable<T> { return { [Symbol.iterator]() { let i = 0; return { next() { return i < items.length ? { done: false, value: items[i++] } : { done: true, value: undefined as any }; }, return() { closed++; return { done: true, value: undefined as any }; } }; } }; }
function sumOfSet(s: Set<any>, start: number): string { let t: any = start; let turns = 0; try { for (const x of s) { turns++; t += x; } } catch (error) { return "caught " + (error as Error).message + " " + t + " " + turns + " " + start + " " + s.size; } return "whole " + t + " " + turns; }
function sumOfList(list: any[], scale: number): string { let t = 0.5; let last: any = null; let i = 0; try { for (const x of list) { i++; last = x; t += x * scale; } } catch (error) { return "caught " + (error as Error).message + " " + t + " " + i + " " + (last === bomb) + " " + scale; } return "whole " + t + " " + i; }
function closesIterator(items: any[], limit: number): string { let t = 0; let seen = ""; try { for (const x of closing(items)) { seen += typeof x; t += x; if (t > limit) break; } } catch (error) { return "caught " + (error as Error).message + " " + t + " " + seen + " " + closed + " " + limit; } return "whole " + t + " " + seen + " " + closed; }
function readsField(objects: any[], base: number): string { let t = base; let index = -1; const made = base * 3 + 1; try { for (let i = 0; i < objects.length; i++) { index = i; t += objects[i].field; } } catch (error) { return (error as Error).constructor.name + " " + t + " " + index + " " + made + " " + base; } return "whole " + t + " " + index + " " + made; }
function inFinally(list: any[], tag: string): string { let t = 0; let turns = 0; let text = tag; try { try { for (const x of list) { turns++; t += x; text += "."; } } finally { text += "|" + t + "|" + turns + "|" + tag; } } catch (error) { return text + " " + (error as Error).message; } return text + " whole"; }
function callsBack(list: number[], f: (x: number) => number, seed: number): string { let t = seed; let k = 0; let fraction = 0.25; try { for (const x of list) { k++; fraction *= 2; t += f(x); } } catch (error) { return "caught " + (error as Error).message + " " + t + " " + k + " " + fraction + " " + seed; } return "whole " + t + " " + k + " " + fraction; }
function* yields(list: any[], mark: string): Generator<number, string, unknown> { let t = 0; let n = 0; try { for (const x of list) { n++; t += x; yield t; } } finally { log.push(mark + " " + t + " " + n); } return "end"; }
const log: string[] = [];
function drains(list: any[], stopAt: number, mark: string): string { let got = ""; try { for (const v of yields(list, mark)) { got += v + ","; if (v >= stopAt) break; } } catch (error) { got += "caught " + (error as Error).message; } return got; }
function nested(outer: any[][], floor: number): string { let t = floor; let rows = 0; let cells = 0; try { for (const row of outer) { rows++; try { for (const x of row) { cells++; t += x; } } catch (error) { t = -t; if (rows > 2) throw error; } } } catch (error) { return "outer " + (error as Error).message + " " + t + " " + rows + " " + cells + " " + floor; } return "whole " + t + " " + rows + " " + cells; }
(globalThis as any).kept = [sumOfSet, sumOfList, closesIterator, readsField, inFinally, callsBack, drains, nested];
for (const at of [0, 1, 4, 9, -1]) { const items: any[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; if (at >= 0) items[at] = bomb; report([at, sumOfSet(new Set(items), at * 10), sumOfList(items, 2), closesIterator(items, 30), inFinally(items, "t" + at), drains(items, 20, "m" + at)].join(" ")); }
for (const at of [0, 2, 5, -1]) { const objects: any[] = [{ field: 1 }, { field: 2 }, { field: 3 }, { field: 4 }, { field: 5 }, { field: 6 }]; if (at >= 0) objects[at] = trap; report([at, readsField(objects, at + 100)].join(" ")); }
for (const at of [1, 3, 7, 99]) report([at, callsBack([1, 2, 3, 4, 5, 6, 7, 8], x => { if (x === at) throw new TypeError("callback " + x); return x * x; }, at)].join(" "));
report([nested([[1, 2], [3, bomb, 4], [5], [bomb], [6]], 7), nested([[1], [2]], 1), nested([[bomb]], 3)].join(" "));
report([log.join(";"), closed].join(" "));
report("end");
