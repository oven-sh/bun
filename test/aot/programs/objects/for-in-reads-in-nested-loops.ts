// A member read by the key of a for-in loop stays the same value in every round of a loop nested in the body, whether that loop is written there or comes from an inlined call.
const lines: string[] = [];
const numbers: Record<string, number> = { a: 5, b: 6, c: 7.5 };
const texts: Record<string, string> = { a: "x", b: "yz" };
const mixed: any = { a: 1, b: "two", c: null, d: undefined, e: [3], f: { g: 4 }, 7: "seven", 0: "zero" };

let atTopLevel = 0;
for (const key in numbers) { const value = numbers[key]; let i = 0; while (i < 3) { atTopLevel += value; i++; } }
lines.push("top level while " + atTopLevel);

let withFor = 0;
for (const key in numbers) { const value = numbers[key]; for (let i = 0; i < 3; i++) withFor += value; }
lines.push("top level for " + withFor);

function whileLoop(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; let i = 0; while (i < 4) { sum += value; i++; } } return sum; }
function forLoop(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 4; i++) sum += value; } return sum; }
function doLoop(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; let i = 0; do { sum += value; i++; } while (i < 4); } return sum; }
function readInside(o: Record<string, number>): number { let sum = 0; for (const key in o) { for (let i = 0; i < 4; i++) sum += o[key]; } return sum; }
function readBoth(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 4; i++) sum += value + o[key]; sum -= value; } return sum; }
function twoLoops(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 2; i++) sum += value; for (let j = 0; j < 3; j++) sum -= value / 2; } return sum; }
function loopInLoop(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) sum += value; } return sum; }
function leftEarly(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 9; i++) { if (i === 2) break; sum += value; } } return sum; }
function skipped(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < 5; i++) { if (i % 2) continue; sum += value; } } return sum; }
function labelled(o: Record<string, number>): number { let sum = 0; outer: for (const key in o) { const value = o[key]; for (let i = 0; i < 5; i++) { if (value > 6 && i === 1) continue outer; sum += value; } } return sum; }
function noRounds(o: Record<string, number>, n: number): number { let sum = 0; for (const key in o) { const value = o[key]; for (let i = 0; i < n; i++) sum += value; sum += value; } return sum; }
function joined(o: Record<string, string>): string { let all = ""; for (const key in o) { const value = o[key]; for (let i = 0; i < 3; i++) all += key + value; } return all; }
function untyped(o: any): string { let all = ""; for (const key in o) { const value = o[key]; for (let i = 0; i < 2; i++) all += key + "=" + String(value) + ";"; } return all; }
function nestedForIn(o: Record<string, number>, p: Record<string, string>): string { let all = ""; for (const key in o) { const value = o[key]; for (const other in p) { const text = p[other]; for (let i = 0; i < 2; i++) all += value + text; } } return all; }
function guarded(o: Record<string, number>): number { let sum = 0; for (const key in o) { if (Object.hasOwn(o, key)) { const value = o[key]; for (let i = 0; i < 3; i++) sum += value; } } return sum; }
function stored(o: Record<string, number>): string { for (const key in o) { const value = o[key]; for (let i = 0; i < 3; i++) o[key] = o[key] + value; } return JSON.stringify(o); }
function removed(o: Record<string, number>): string { let all = ""; for (const key in o) { const value = o[key]; delete o.b; for (let i = 0; i < 2; i++) all += key + value; } return all; }
function caught(o: Record<string, number>): number { let sum = 0; for (const key in o) { const value = o[key]; try { for (let i = 0; i < 3; i++) { if (i === 2) throw new Error("out"); sum += value; } } catch { sum += value * 100; } } return sum; }
lines.push([whileLoop(numbers), forLoop(numbers), doLoop(numbers), readInside(numbers), readBoth(numbers), twoLoops(numbers), loopInLoop(numbers), leftEarly(numbers), skipped(numbers), labelled(numbers), noRounds(numbers, 0), noRounds(numbers, 2)].join(" "));
lines.push(joined(texts), untyped(mixed), untyped([1, 2]), untyped("ab"), nestedForIn(numbers, texts), String(guarded(numbers)), stored({ a: 1, b: 2 }), removed({ a: 1, b: 2, c: 3 }), String(caught(numbers)));

let calls = 0;
const table: Record<string, (n: number) => void> = { first(n) { calls += n; }, second(n) { calls += n * 10; } };
function callThrice(f: (n: number) => void): void { for (let i = 0; i < 3; i++) f(i); }
for (const key in table) callThrice(table[key]);
lines.push("calls " + calls);

class Base { inherited = 1; }
class Heir extends Base { own = 2; }
function overInstance(o: any): string { let all = ""; for (const key in o) { const value = o[key]; for (let i = 0; i < 2; i++) all += key + value; } return all; }
lines.push(overInstance(new Heir()), overInstance(Object.create({ fromPrototype: 3 }, { own: { value: 4, enumerable: true } })), overInstance(Object.assign(Object.create({ a: "shadowed", z: "far" }), { a: "near" })));

function many(rounds: number): number { let sum = 0; for (let r = 0; r < rounds; r++) { const o: Record<string, number> = { a: r, b: r + 0.5 }; for (const key in o) { const value = o[key]; for (let i = 0; i < 3; i++) sum += value; } } return sum; }
lines.push("many " + many(2000));
console.log(lines.join("\n"));
