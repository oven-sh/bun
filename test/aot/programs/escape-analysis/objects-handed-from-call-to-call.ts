// Escape analysis across calls: a small object returned by one function and only read by the next is not allocated, including when it merges with other fresh objects at a phi.
// IR= 0 handedOn : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 handedOnTwice : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 joinedWithItsSource : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 joinedThenHandedOn : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 carriedByLoop : =?L[0-9]+ = NewObject |CallDirect
// IR= 0 madeAheadOfTheBranch : =?L[0-9]+ = NewObject 
// IR= 1 keptResultFreesItsArgument : =?L[0-9]+ = NewObject 
// IR= 0 keptResultFreesItsArgument CallDirect
// IR= 1 isKeptByTheCallee : =?L[0-9]+ = NewObject |CallDirect
// IR= 1 isReturnedByTheCallee : =?L[0-9]+ = NewObject |CallDirect
// IR= 2 isWrittenBehindTheJoin : =?L[0-9]+ = NewObject |CallDirect
// IR= 2 sourceIsWrittenBehindTheJoin : =?L[0-9]+ = NewObject |CallDirect
// IR= 1 isEnumerated : =?L[0-9]+ = NewObject |CallDirect
declare const console: { log(...v: unknown[]): void };
interface Range { low: number; high: number }
function range(low: number, high: number): Range { return { low, high }; }
function widened(r: Range, by: number): Range { return { low: r.low - by, high: r.high + by }; }
function summed(r: Range, s: Range): Range { return { low: r.low + s.low, high: r.high + s.high }; }
function overlap(r: Range, s: Range): number { return (r.high - s.low) * (s.high - r.low); }
function tightened(r: Range): Range { const width = r.high - r.low; return width === 0 ? r : widened(r, -width / 4); }

function handedOn(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += overlap(range(i, i + 4), range(3, i * 2)); return t; }
function handedOnTwice(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += overlap(widened(summed(range(i, 9), widened(range(1, i), 0.5)), i), range(2, 3)); return t; }
function joinedWithItsSource(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const u = tightened(range(1, 1 + i % 3)); t += u.low * 4 + u.high; } return t; }
function joinedThenHandedOn(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const u = tightened(range(i % 2, i % 3)); for (let k = 0; k < 3; k++) t += overlap(widened(u, k), u); } return t; }
function carriedByLoop(n: number): number { let all = range(0, 0); for (let i = 0; i < n; i++) all = summed(all, range(i, 0.5)); return all.low + all.high * 3; }
function madeAheadOfTheBranch(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r: Range = { low: i, high: i + 1 }; const k = r.low + r.high; const u: Range = k % 3 === 0 ? r : { low: r.low - k, high: r.high * k }; for (let j = 0; j < 2; j++) t += u.low * j + u.high; } return t; }
function keptResultFreesItsArgument(out: Range[], n: number): number { for (let turn = 0; turn < n; turn++) for (let i = 0; i < out.length; i++) out[i] = summed(out[i]!, widened(range(i, turn), 0.5)); let t = 0; for (const r of out) t += r.low + r.high * 2; return t; }

let last: Range | undefined;
function same(r: Range, s: Range): number { return r === s ? 1 : 0; }
function raise(r: Range): number { r.high += 1; return r.high; }
function keep(r: Range, k: number): number { last = r; return r.low + k; }
function self(r: Range): Range { return r; }
const shared: Range = { low: 100, high: 300 };
function large(r: Range): number { let t = 0; for (let i = 0; i < 3; i++) { t += r.low * i + r.high; if (t > 1e9) t -= r.high; if (t < -1e9) t += r.low * 2; t = (t * 29 + r.low) % 999983; t = (t * 19 + r.high) % 999983; t = (t * 11 + r.low) % 999983; } return t; }

function isComparedByTheCallee(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r = range(i, 2); t += same(r, r) * 2 + same(r, range(i, 2)); } return t; }
function isWrittenByTheCallee(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r = range(1, i); t += raise(r) + raise(r) + r.high; } return t; }
function isKeptByTheCallee(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += keep(range(i, 2), i); return t + (last ? last.low + last.high : -1); }
function isReturnedByTheCallee(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r = range(i, 1); const s = self(r); s.high = i * 2; t += r.high + (r === s ? 10 : 0); } return t; }
function isWrittenBehindTheJoin(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r = range(i, 1); const u = i & 1 ? r : widened(r, 2); u.low = u.high + 7; t += u.low + r.low; } return t; }
function sourceIsWrittenBehindTheJoin(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const r = range(i, 1); const u = i & 1 ? r : widened(r, 2); r.low = 1000; t += u.low + u.high; } return t; }
function oneArmIsShared(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const u = i & 1 ? shared : widened(shared, 2); shared.low = i; t += overlap(u, u); } return t; }
function sharedGoesThroughTightened(n: number): number { let t = 0; for (let i = 0; i < n; i++) { shared.low = 4; shared.high = 4 + i % 2; const u = tightened(shared); shared.low = 5; t += u.low + (u === shared ? 100 : 0); } return t; }
function isReadByALargeFunction(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + large(summed(range(i, 2), range(1, i)))) % 999983; return t; }
function throwsBetween(n: number): string { let out = ""; for (let i = 0; i < n; i++) { let seen = -1; try { const r = summed(range(i, 2), range(1, 1)); seen = r.low; if (i % 3 === 1) throw new Error("between"); seen = overlap(r, widened(r, 2)); } catch { out += "caught;"; } out += seen + ";"; } return out; }
function holdsNotANumber(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const r = widened(range(-0, Infinity), i - 1); const s = summed(r, widened(r, -Infinity)); out += [Object.is(r.low, -0), r.low, r.high, s.low, s.high].join() + ";"; } return out; }
function isEnumerated(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const r = summed(range(i, 2), widened(range(1, 3), i)); out += Object.keys(r).join("") + JSON.stringify(r) + ";"; } return out; }

const list: Range[] = []; for (let i = 0; i < 5; i++) list.push(range(i, i * 2));
console.log(handedOn(50), handedOnTwice(50), joinedWithItsSource(50), joinedThenHandedOn(50), carriedByLoop(50), madeAheadOfTheBranch(50), keptResultFreesItsArgument(list, 7));
console.log(isComparedByTheCallee(20), isWrittenByTheCallee(20), isKeptByTheCallee(20), isReturnedByTheCallee(20), isWrittenBehindTheJoin(20), sourceIsWrittenBehindTheJoin(20), oneArmIsShared(20), sharedGoesThroughTightened(20), isReadByALargeFunction(20));
console.log(throwsBetween(7), holdsNotANumber(3), isEnumerated(3));
