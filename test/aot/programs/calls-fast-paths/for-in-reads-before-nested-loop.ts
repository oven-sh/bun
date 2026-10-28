// `o[k]` at the start of the body of `for (k in o)` is read without a lookup while the key is still listed, also where a loop follows the read: the copy of the body that does so ends ahead of that loop.
// IR= 1 loopBehindTheRead  = GetForInSlot v[0-9]+, 
// IR= 1 whileBehindTheRead  = GetForInSlot v[0-9]+, 
// IR= 1 loopBehindHasOwn  = GetForInSlot v[0-9]+, 
// IR= 1 loopOnAFlagBehindTheRead  = GetForInSlot v[0-9]+, 
// IR= 1 loopOnTheMemberBehindTheRead  = GetForInSlot v[0-9]+, 
// IR= 1 loopBehindTheReadOfAGivenObject  = GetForInSlot v[0-9]+, 
declare const console: any;
let calls = 0;
function tick(): number { return ++calls; }
function loopBehindTheRead(laps: number): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < laps; i++) sum += v; } return sum; }
function whileBehindTheRead(laps: number): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let i = 0; while (i < laps) { sum += v; i++; } } return sum; }
function loopBehindHasOwn(laps: number): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { if (!Object.hasOwn(o, k)) continue; const v = o[k]; for (let i = 0; i < laps; i++) sum += v; } return sum; }
function loopOnAFlagBehindTheRead(laps: number): number { const o: Record<string, number> = { a: 5, b: 6 }; let sum = 0; for (const k in o) { const v = o[k]; let go = true; while (go) { go = tick() % laps !== 0; sum += v; } } return sum; }
function loopOnTheMemberBehindTheRead(limit: number): number { const o: Record<string, number> = { a: 1, b: 2 }; let sum = 0; for (const k in o) { const first = o[k]; while (o[k] < limit) { o[k] += 1; sum += first; } } return sum; }
function loopBehindTheReadOfAGivenObject(o: Record<string, number>, laps: number): number { let sum = 0; for (const k in o) { const v = o[k]; for (let i = 0; i < laps; i++) sum += v; } return sum; }
// Called outside any loop: top-level code that runs once takes nothing in, so each function keeps a body for the expectations to look at.
console.log(loopBehindTheRead(3), whileBehindTheRead(3), loopBehindHasOwn(3), loopOnAFlagBehindTheRead(3), loopOnTheMemberBehindTheRead(4), loopBehindTheReadOfAGivenObject({ a: 1, b: 2, c: 3 }, 3));
console.log(loopBehindTheRead(0), whileBehindTheRead(1), loopBehindHasOwn(0), loopOnAFlagBehindTheRead(1), loopOnTheMemberBehindTheRead(0), loopBehindTheReadOfAGivenObject(Object.create({ up: 7 }), 2));
export {};
