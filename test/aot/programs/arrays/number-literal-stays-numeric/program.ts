// How an array literal keeps its elements from its birth goes by its type, written around it or worked out by the checker: a list of numbers keeps numbers, which is what every place typed number[] expects.
declare const console: { log(...values: unknown[]): void };
declare function describe(value: unknown): string;
function kind(list: unknown): string { return (/(CopyOnWrite)?ArrayWith\w+/.exec(describe(list))?.[0] ?? "no array").replace("CopyOnWrite", ""); }
function total(list: number[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
const written: number[] = [31, 28, 31, 30];
const workedOut = [31, 28, 31, 30];
const halves = [0.5, 1.5];
function writtenResult(x: number, y: number): number[] { return [x, y]; }
function workedOutResult(x: number, y: number) { return [x, y]; }
function constants() { return [1, 2, 3]; }
const nested = [[1, 2], [3, 4]];
const inAnObject = { days: [31, 28] };
const texts = ["a", "b"];
const mixed = [1, "a"];
const asAny: any = [1, 2, 3];
const tuple = [1, 2] as const;
for (const [name, list] of Object.entries({ written, workedOut, halves, writtenResult: writtenResult(1, 2), workedOutResult: workedOutResult(1, 2), constants: constants(), nested: nested[1], inAnObject: inAnObject.days }))
    console.log(name + ": " + kind(list) + " " + JSON.stringify(list) + " " + total(list));
for (const [name, list] of Object.entries({ texts, mixed, asAny, tuple, outer: nested }))
    console.log(name + ": " + kind(list) + " " + JSON.stringify(list));
