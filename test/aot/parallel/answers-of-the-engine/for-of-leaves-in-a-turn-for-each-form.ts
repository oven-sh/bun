// What a for-of walks over stops being what it was written as in the middle of a turn, for each form that an open makes. The loop steps on, and a break behind it closes what has a return.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
let closed = 0;
let finished = 0;
function total(items: any, bias: number): number { let sum = bias; for (const item of items) sum += (item as number) * bias; return sum; }
function first(items: any, scale: number[], stop: number): number { let sum = 0; let turn = 0; for (const item of items) { sum += (item as number) * scale[turn++]!; if (turn === stop) break; } return sum; }
function ofList(items: number[], scale: number[]): number { let sum = 0; let turn = 0; for (const item of items) sum += item * scale[turn++]!; return sum; }
function ofView(items: Float64Array, scale: number[]): number { let sum = 0; let turn = 0; for (const item of items) sum += item * scale[turn++]!; return sum; }
function ofSet(items: Set<number>, scale: number[]): number { let sum = 0; let turn = 0; for (const item of items) sum += item * scale[turn++]!; return sum; }
function ofMap(items: Map<number, number>, scale: number[]): number { let sum = 0; let turn = 0; for (const [key, value] of items) sum += (key * 100 + value) * scale[turn++]!; return sum; }
function ofKeys(items: Map<number, number>, scale: number[]): number { let sum = 0; let turn = 0; for (const key of items.keys()) sum += key * scale[turn++]!; return sum; }
function ofValues(items: Map<number, number>, scale: number[]): number { let sum = 0; let turn = 0; for (const value of items.values()) sum += value * scale[turn++]!; return sum; }
function ofText(items: string, scale: number[]): number { let sum = 0; let turn = 0; for (const item of items) sum += item.length * scale[turn++]!; return sum; }
function* count(limit: number): Generator<number> { try { for (let n = 1; n <= limit; n++) yield n; } finally { finished++; } }
function ofGenerator(limit: number, scale: number[]): number { let sum = 0; let turn = 0; for (const item of count(limit)) sum += item * scale[turn++]!; return sum; }
function steps(limit: number): Iterable<number> { return { [Symbol.iterator]() { let n = 0; return { next() { n++; return { done: n > limit, value: n }; }, return() { closed++; return { done: true, value: 0 }; } }; } }; }
function ofObject(items: Iterable<number>, scale: number[]): number { let sum = 0; let turn = 0; for (const item of items) sum += item * scale[turn++]!; return sum; }
const plain = [1, 2, 3, 4];
const mixed = [1, "2", 3, 4] as number[];
const table = new Map([[1, 10], [2, 20], [3, 30]]);
for (const scale of [plain, mixed, plain]) { report(ofList([5, 6, 7], scale)); report(ofView(new Float64Array([1.5, 2.5, 3.5]), scale)); report(ofSet(new Set([5, 6, 7]), scale)); report(ofMap(table, scale)); report(ofKeys(table, scale)); report(ofValues(table, scale)); report(ofText("a\u{1F600}b", scale)); report(ofGenerator(3, scale)); report(finished); report(ofObject(steps(3), scale)); report(closed); }
for (const scale of [plain, mixed, plain]) { report(first([5, 6, 7, 8], scale, 3)); report(first(new Float64Array([1.5, 2.5, 3.5, 4.5]), scale, 3)); report(first(new Set([5, 6, 7, 8]), scale, 3)); report(first(table.keys(), scale, 3)); report(first("1234", scale, 3)); report(first(count(4), scale, 3)); report(finished); report(first(steps(4), scale, 3)); report(closed); }
report(total([1, "2", 3], 2));
report(total(new Float64Array([1.5, 2.5]), 2));
report(total(new Set([1, "2", 3]), 2));
report(total(new Map([[1, "2"]]).values(), 2));
report(total(table, 2));
report(total("123", 2));
report(total(count(3), 2));
report(total(steps(3), 2));
report(finished);
report(closed);
report("end");
