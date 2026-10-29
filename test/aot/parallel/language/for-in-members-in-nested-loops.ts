// What is made at the start of the body of a for-in loop (a member read by the key, the answer of Object.hasOwn, a typeof) is used in or behind a loop nested in that body.
declare const console: { log(...values: unknown[]): void };
let flag = JSON.parse("true") as boolean;
let calls = 0;
function tick(): number { return ++calls; }

function whileInBody(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let i = 0; while (i < 3) { sum += v; i++; } } return sum; }
function forInBody(): unknown { const o: Record<string, number> = { a: 5 }; let total: any = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < 3; i++) total += v; } return total; }
function doWhileInBody(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let i = 0; do { sum += v; i++; } while (i < 3); } return sum; }
function usedBehindTheLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let i = 0; while (i < 3) i++; sum += v + i; } return sum; }
function usedInAndBehind(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let i = 0; while (i < 3) { sum += v; i++; } sum -= v; } return sum; }
function twoLoopsDeep(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) sum += v; } return sum; }
function keyInTheLoop(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) text += k + v; } return text; }
function readInTheLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { for (let i = 0; i < 3; i++) sum += o[k]; } return sum; }
function readBeforeAndInTheLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < 3; i++) sum += o[k] - v + 1; } return sum; }
function loopOnAFlag(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const kind = typeof flag; let go = true; while (go) { const v = o[k]; tick(); sum += v + kind.length; go = false; } } return sum; }
function loopOnAFlagUsedBehind(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const kind = typeof flag; let go = true; let n = 0; while (go) { const v = o[k]; n += tick() * 0 + v; go = n < 12; } text += kind + n; } return text; }
function hasOwnThenLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { if (Object.hasOwn(o, k)) { const v = o[k]; for (let i = 0; i < 3; i++) sum += v; } } return sum; }
function inThenLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { if (k in o) { for (let i = 0; i < 3; i++) sum += i; } else sum = -1; } return sum; }
function hasOwnValueInLoop(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const has = Object.hasOwn(o, k); for (let i = 0; i < 2; i++) text += has; } return text; }
function nestedForIn(): string { const o: Record<string, Record<string, number>> = { a: { x: 1, y: 2 }, b: { z: 3 } }; let text = ""; for (const k in o) { const inner = o[k]; for (const j in inner) { const v = inner[j]; for (let i = 0; i < 2; i++) text += k + j + v; } } return text; }
function nestedForInSameObject(): number { const o: Record<string, number> = { a: 1, b: 2, c: 3 }; let sum = 0; for (const k in o) { const v = o[k]; for (const j in o) { const w = o[j]; sum += v * w; } } return sum; }
function forOfInBody(): number { const o: Record<string, number> = { a: 5, b: 6 }; const list = [1, 2, 3]; let sum = 0; for (const k in o) { const v = o[k]; for (const n of list) sum += v * n; } return sum; }
function forInInForOf(): number { const list: Record<string, number>[] = [{ a: 1 }, { b: 2, c: 3 }]; let sum = 0; for (const o of list) for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) sum += v; } return sum; }
function overAnArray(): number { const list = [5, 6, 7]; let sum = 0; for (const k in list) { const v = list[k as any]; for (let i = 0; i < 3; i++) sum += v; } return sum; }
function overAnArrayOfAny(): unknown { const list: any = [5, "x", 7]; let sum: any = 0; for (const k in list) { const v = list[k]; for (let i = 0; i < 2; i++) sum += v; } return sum; }
class Point { x = 1; y = 2; z = 3; }
function overAnInstance(): number { const p: any = new Point(); let sum = 0; for (const k in p) { const v = p[k]; for (let i = 0; i < 3; i++) sum += v; } return sum; }
class Derived extends Point { w = 4; get hidden(): number { return 100; } }
function overADerivedInstance(): number { const p = new Derived() as unknown as Record<string, number>; let sum = 0; for (const k in p) { const v = p[k]; let i = 0; while (i < 2) { sum += v; i++; } } return sum; }
function overInheritedKeys(): string { const base = { a: 1, b: 2 }; const o: Record<string, number> = Object.create(base); o.c = 3; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) text += k + v; } return text; }
function inAClosure(): number { const o: Record<string, number> = { a: 5, b: 6 }; const later: (() => number)[] = []; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) later.push(() => v + i); } let sum = 0; for (const f of later) sum += f(); return sum; }
function closureCalledInLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; const add = () => { sum += v; }; for (let i = 0; i < 3; i++) add(); } return sum; }
function inTryFinally(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { try { const v = o[k]; for (let i = 0; i < 2; i++) text += v; } finally { text += ";"; } } return text; }
function tryInTheLoop(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) { try { if (i && v > 5) throw new Error("e" + v); text += v; } catch (e) { text += (e as Error).message; } } } return text; }
function labeledContinue(): number { const o: Record<string, number> = { a: 5, b: 6, c: 7 }; let sum = 0; outer: for (const k in o) { const v = o[k]; for (let i = 0; i < 4; i++) { if (i === 2 && v === 6) continue outer; sum += v; } sum += 100; } return sum; }
function labeledBreak(): number { const o: Record<string, number> = { a: 5, b: 6, c: 7 }; let sum = 0; outer: for (const k in o) { const v = o[k]; for (let i = 0; i < 4; i++) { if (i === 2 && v === 6) break outer; sum += v; } } return sum; }
function breakOutOfTheInner(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (;;) { sum += v; if (sum > 20) break; } } return sum; }
function insideAnOuterLoop(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (let r = 0; r < 2; r++) { for (const k in o) { const v = o[k]; if (v > 5 && r) break; sum += v; } sum *= 2; } return sum; }
function valueLeavesByBreak(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (let r = 0; r < 3; r++) { let last = 0; for (const k in o) { last = o[k]; if (r === 1) break; } sum += last; } return sum; }
function thrice(f: () => void): void { for (let i = 0; i < 3; i++) f(); }
function functionsAsMembers(): number { let n = 0; const o: Record<string, () => void> = { a() { n += 1; }, b() { n += 10; } }; for (const k in o) thrice(o[k]); return n; }
function sumThrice(v: number): number { let s = 0; for (let i = 0; i < 3; i++) s += v; return s; }
function afterInlining(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) sum += sumThrice(o[k]); return sum; }
function objectsAsMembers(): string { const o: Record<string, { n: number }> = { a: { n: 1 }, b: { n: 2 } }; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) { v.n += i; text += v.n; } } return text; }
function stringsAsMembers(): string { const o: Record<string, string> = { a: "x", b: "y" }; let text = ""; for (const k in o) { const v = o[k]; let i = 0; while (i++ < 2) text += v; } return text; }
function deletedOnTheWay(): string { const o: Record<string, number> = { a: 1, b: 2, c: 3 }; let text = ""; for (const k in o) { const v = o[k]; delete o.b; for (let i = 0; i < 2; i++) text += k + v; } return text; }
function changedInTheLoop(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) { o[k] = v + 10; text += v + ":" + o[k] + " "; } } return text; }
function castsOnTheWay(): string { const o: Record<string, unknown> = { a: 1, b: "two" }; let text = ""; for (const k in o) { const v = o[k] as string | number; const kind = typeof v; for (let i = 0; i < 2; i++) text += kind + v; } return text; }
function constantsOnTheWay(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const v = o[k]; const mark = "!"; const step = 2; for (let i = 0; i < 4; i += step) text += v + mark; } return text; }
function switchInTheLoop(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const v = o[k]; for (let i = 0; i < 3; i++) { switch (i) { case 0: text += v; break; case 1: text += k; break; default: text += "-"; } } } return text; }
function* yieldsInTheLoop(): Generator<number> { const o: Record<string, number> = { a: 5, b: 6 }; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) yield v + i; } }
async function awaitsInTheLoop(): Promise<number> { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < 2; i++) sum += await Promise.resolve(v); } return sum; }
function given(o: Record<string, number>, rounds: number): number { let sum = 0; for (const k in o) { const v = o[k]; let i = 0; while (i < rounds) { sum += v; i++; } } return sum; }
function givenAny(o: any, rounds: number): unknown { let sum: any = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < rounds; i++) sum += v; } return sum; }

const table: Record<string, number> = { a: 5, b: 6 };
let atModuleLevel = 0;
for (const key in table) { const value = table[key]; let i = 0; while (i < 3) { atModuleLevel += value; i++; } }
let atModuleLevelFor = 0;
for (const key in table) { const value = table[key]; for (let i = 0; i < 3; i++) atModuleLevelFor += value; }

function madeBeforeALoopOnAFlag(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const kind = typeof flag; let go = true; while (go) { const v = o[k]; const t = tick(); if (flag) text += kind; go = t % 3 !== 0; text += v; } } return text; }
function hasOwnInALoopOnAFlag(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const kind = typeof flag; let go = true; while (go) { const has = Object.hasOwn(o, k); const t = tick(); if (flag) text += kind; go = t % 3 !== 0; text += has; } } return text; }
function readBeforeAndInALoopOnAFlag(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const first = o[k]; let go = true; while (go) { const v = o[k]; const t = tick(); if (flag) text += first; go = t % 3 !== 0; text += v; } } return text; }
function doWhileReads(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const kind = typeof flag; do { const v = o[k]; const t = tick(); if (flag) text += kind; text += v; if (t % 3 === 0) break; } while (true); } return text; }
function doWhileAfterARead(): string { const o: Record<string, number> = { a: 5, b: 6 }; let text = ""; for (const k in o) { const first = o[k]; do { const v = o[k]; const t = tick(); if (flag) text += first; text += v; if (t % 3 === 0) break; } while (true); } return text; }
function whileOnARead(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const kind = typeof flag; while (o[k] < 4) { o[k] += 1; if (flag) text += kind; } } return text + o.a + o.b; }
function whileOnAReadAfterARead(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const first = o[k]; while (o[k] < 4) { o[k] += 1; if (flag) text += first; } } return text + o.a + o.b; }
function whileOnHasOwn(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const kind = typeof flag; while (Object.hasOwn(o, k)) { delete o[k]; if (flag) text += kind + k; } } return text; }
function whileOnIn(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const first = o[k]; while (k in o) { delete o[k]; if (flag) text += first + k; } } return text; }
function whileOnAReadNothingBefore(): string { const o: Record<string, number> = { a: 1, b: 2 }; let n = 0; for (const k in o) { while (o[k] < 4) { o[k] += 1; n++; } } return n + ":" + o.a + o.b; }
function anArmLeadsIntoALoop(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const kind = typeof flag; if (flag) while (o[k] < 4) { o[k] += 1; if (flag) text += kind; } else text += "-"; } return text + o.a + o.b; }
function anArmLeadsIntoALoopAfterARead(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const first = o[k]; if (flag) while (o[k] < 4) { o[k] += 1; if (flag) text += first; } else text += "-"; } return text + o.a + o.b; }
function aKnownArmLeadsIntoALoop(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const first = o[k]; if (k in o) for (let i = 0; i < 2; i++) text += first; else text += "-"; } return text; }
function twoReadsOneLoop(): string { const o: Record<string, number> = { a: 1, b: 2 }; const p: Record<string, number> = { a: 10, b: 20 }; let text = ""; for (const k in o) { const v = o[k]; const w = p[k]; for (let i = 0; i < 2; i++) text += v + w; } return text; }
function theLoopNeverRuns(): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < calls * 0; i++) sum -= v; sum += v; } return sum; }
function manyLaps(): number { const o: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < 1000; i++) sum += v; } return sum; }
function constantOnly(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { if (k in o) { const mark = "!"; const step = 1; for (let i = 0; i < 3; i += step) { if (flag) text += mark; } } } return text; }
function castOfAConstant(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { if (Object.hasOwn(o, k)) { const wide: string | number = "w"; for (let i = 0; i < 3; i++) { if (flag) text += wide; } } } return text; }
function castOfWhatStoodBefore(outer: number): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; const before: number = outer + 1; for (const k in o) { if (k in o) { const wide: string | number = before; for (let i = 0; i < 3; i++) { if (flag) text += wide; } } } return text; }
function knownAnswerInLaterLaps(): string { const o: Record<string, number> = { a: 1, b: 2 }; let text = ""; for (const k in o) { const has = k in o; const not = !has; for (let i = 0; i < 3; i++) { if (flag) text += has; if (i === 2) text += not; } } return text; }

console.log(atModuleLevel, atModuleLevelFor);
console.log(whileInBody(), forInBody(), doWhileInBody(), usedBehindTheLoop(), usedInAndBehind(), twoLoopsDeep(), keyInTheLoop());
console.log(readInTheLoop(), readBeforeAndInTheLoop(), loopOnAFlag(), loopOnAFlagUsedBehind(), hasOwnThenLoop(), inThenLoop(), hasOwnValueInLoop());
console.log(nestedForIn(), nestedForInSameObject(), forOfInBody(), forInInForOf(), overAnArray(), overAnArrayOfAny());
console.log(overAnInstance(), overADerivedInstance(), overInheritedKeys(), inAClosure(), closureCalledInLoop());
console.log(inTryFinally(), tryInTheLoop(), labeledContinue(), labeledBreak(), breakOutOfTheInner(), insideAnOuterLoop(), valueLeavesByBreak());
console.log(functionsAsMembers(), afterInlining(), objectsAsMembers(), stringsAsMembers(), deletedOnTheWay(), changedInTheLoop());
console.log(castsOnTheWay(), constantsOnTheWay(), switchInTheLoop(), [...yieldsInTheLoop()].join());
console.log(given({ p: 2, q: 3 }, 4), given({}, 4), given({ p: 2 }, 0), givenAny({ p: "s", q: 3 }, 2), givenAny([4, 5], 2), givenAny("ab", 2), givenAny(null, 2));
for (const run of [madeBeforeALoopOnAFlag, hasOwnInALoopOnAFlag, readBeforeAndInALoopOnAFlag, doWhileReads, doWhileAfterARead]) { calls = 0; console.log(run()); }
console.log(whileOnARead(), whileOnAReadAfterARead(), whileOnHasOwn(), whileOnIn(), whileOnAReadNothingBefore());
console.log(anArmLeadsIntoALoop(), anArmLeadsIntoALoopAfterARead(), aKnownArmLeadsIntoALoop(), twoReadsOneLoop(), theLoopNeverRuns(), manyLaps());
console.log(constantOnly(), castOfAConstant(), castOfWhatStoodBefore(4), knownAnswerInLaterLaps());
flag = false;
console.log(anArmLeadsIntoALoop(), anArmLeadsIntoALoopAfterARead(), whileOnARead(), whileOnIn());
awaitsInTheLoop().then(sum => console.log(sum));
