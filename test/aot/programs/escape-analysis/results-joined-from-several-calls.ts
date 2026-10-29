// An object that comes from one of several calls and is only read is never made: its fields are read where each call returns.
// IR= 0 forwardedByBranches PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 dispatchedByClass PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 chosenByCondition PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 chosenOfThree PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 carriedByLoop PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 differentOrderOfFields PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 readAfterOtherWork PropGet|: =?L[0-9]+ = NewObject 
type P = { x: number; y: number };
let noise = 0;
let guard = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function work(i: number): number { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); if (guard > 1e9) return work(i + 1); return (i * 31 + noise) | 0; }
function first(i: number): P { const s = work(i); return { x: s, y: s + 3 }; }
function second(i: number): P { const s = work(i + 1); return { x: s - 1, y: s + 5 }; }
function third(i: number): P { const s = work(i + 2); return { x: s * 2, y: 7 }; }
function swapped(i: number): P { const s = work(i + 3); return { y: s + 9, x: s }; }
function throwing(i: number): P { const s = work(i); if (i % 5 === 3) throw new RangeError("at " + i); return { x: s, y: 1 }; }
function maybe(i: number): P | undefined { if (i % 3 === 0) return undefined; const s = work(i); return { x: s, y: 2 }; }
function forward(i: number): P { if (i < 0) return first(-i); return second(i); }
interface Maker { make(i: number): P }
class A implements Maker { make(i: number): P { const s = work(i); return { x: s, y: s + 3 }; } }
class B implements Maker { make(i: number): P { const s = work(i + 1); return { x: s, y: s + 5 }; } }
const makers: Maker[] = [new A(), new B()];
const kept: P[] = [];
const shared: P = { x: 100, y: 200 };
function takes(p: P): number { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); if (guard > 1e9) return takes(p); kept.push(p); return p.x; }

function forwardedByBranches(n: number): number { let t = 0; for (let i = -n; i < n; i++) { const { x, y } = forward(i); t = (t + x + y) | 0; } return t; }
function dispatchedByClass(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const { x, y } = makers[i & 1].make(i); t = (t + x + y) | 0; } return t; }
function chosenByCondition(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i % 3 ? first(i) : second(i); t = (t + p.x * 2 + p.y) | 0; } return t; }
function chosenOfThree(n: number): number { let t = 0; for (let i = 0; i < n; i++) { let p: P; if (i % 3 === 0) p = first(i); else if (i % 3 === 1) p = second(i); else p = third(i); t = (t + p.y) | 0; if (i & 1) t = (t + p.x) | 0; } return t; }
function carriedByLoop(n: number): number { let p = first(0); for (let i = 1; i < n; i++) p = second(i + (p.x & 1)); return p.x + p.y; }
function readAfterOtherWork(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : third(i); shared.x = i; kept.length = 0; t = (t + work(i)) | 0; t = (t + p.x + p.y + shared.x) | 0; } return t; }
function differentOrderOfFields(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : swapped(i); t = (t + p.x - p.y) | 0; } return t; }

function isKept(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); kept.push(p); t = (t + p.x) | 0; } return t + kept.length; }
function isPassed(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); t = (t + takes(p) + p.y) | 0; } return t; }
function isCompared(n: number): number { let t = 0; let last: P | undefined; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); if (p === last) t += 1000; if (p !== p) t += 5000; last = p; t = (t + p.x) | 0; } return t; }
function isWritten(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); p.x = p.y + 1; t = (t + p.x + p.y) | 0; } return t; }
function oneArmIsShared(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : shared; shared.x = i * 7; shared.y = i * 11; t = (t + p.x + p.y) | 0; } return t; }
function isEnumerated(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : swapped(i); out += Object.keys(p).join("") + ("x" in p) + JSON.stringify(p).length + ";"; } return out; }
function readsWhatIsInherited(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); out += typeof p.toString + String((p as unknown as { z?: number }).z) + p.hasOwnProperty("y") + ";"; } return out; }
function mayBeAbsent(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? maybe(i) : maybe(i + 1); if (p) t = (t + p.x + p.y) | 0; else t = (t + 13) | 0; } return t; }
function oneArmMayBeAbsent(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : maybe(i); t = (t + (p ? p.x + p.y : -4)) | 0; } return t; }
function throwsInAnArm(n: number): string { let out = ""; let t = 0; for (let i = 0; i < n; i++) { try { const p = i & 1 ? throwing(i) : first(i); t = (t + p.x + p.y) | 0; } catch (e) { out += (e instanceof RangeError ? e.message : "other") + ";"; } } return out + t; }
function throwsBetween(n: number): string { let out = ""; for (let i = 0; i < n; i++) { let seen = -1; try { const p = i & 1 ? first(i) : second(i); seen = p.x; if (i % 4 === 2) throw new Error("between"); seen = p.y; } catch (e) { out += "caught;"; } out += seen + ";"; } return out; }
function unchangedOnSomePaths(n: number): number { let p = first(0); let t = 0; for (let i = 1; i < n; i++) { if (i % 3 === 0) p = second(i); t = (t + p.x + p.y) | 0; } return t; }
function capturedByClosure(n: number): number { let t = 0; const readers: (() => number)[] = []; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); readers.push(() => p.x + p.y); } for (const read of readers) t = (t + read()) | 0; return t; }
function* yieldsBetween(n: number): Generator<number, number, number> { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); const sent = yield p.x; t = (t + p.y + sent) | 0; } return t; }
async function awaitsBetween(n: number): Promise<number> { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); await null; shared.x = i; t = (t + p.x + p.y) | 0; } return t; }
function usesArguments(this: unknown, n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? first(i) : second(i); t = (t + p.x + arguments.length) | 0; } return t; }
function stackOfAnArm(): string { function deep(i: number): P { const s = work(i); if (s !== s + 0) return { x: 0, y: 0 }; const e = new Error("deep"); return { x: (e.stack ?? "").split("\n").filter(line => line.includes("deep") || line.includes("middle")).length, y: s }; } function middle(i: number): P { if (i < 0) return deep(-i); return deep(i); } const p = middle(3); return p.x > 0 ? "has frames" : "no frames"; }

const out: unknown[] = [];
out.push(forwardedByBranches(40), dispatchedByClass(40), chosenByCondition(40), chosenOfThree(40), carriedByLoop(40), readAfterOtherWork(40), differentOrderOfFields(40));
out.push(isKept(20), isPassed(20), isCompared(20), isWritten(20), oneArmIsShared(20), isEnumerated(6), readsWhatIsInherited(4), mayBeAbsent(20), oneArmMayBeAbsent(20));
out.push(throwsInAnArm(20), throwsBetween(12), unchangedOnSomePaths(20), capturedByClosure(12), usesArguments(10), stackOfAnArm());
const steps = yieldsBetween(6); let step = steps.next(0); let sum = 0; while (!step.done) { sum = (sum + step.value) | 0; step = steps.next(sum & 7); } out.push(sum, step.value);
guard += out.length > 1e12 ? 1 : 0;
awaitsBetween(8).then(value => { out.push(value, kept.length, kept.length ? kept[kept.length - 1].x : -1); for (const line of out) console.log(line); });
