// An object that is one of several literals, chosen by a condition, and is only read is never made.
// IR= 0 eitherLiteral PropGet| = New(Plain)?Object 
// IR= 0 oneOfThree PropGet| = New(Plain)?Object 
// IR= 0 literalOrCall PropGet| = New(Plain)?Object 
// IR= 0 nested PropGet| = New(Plain)?Object 
// IR= 0 setAfterwards PropGet| = New(Plain)?Object 
// IR= 0 carried PropGet| = New(Plain)?Object 
type P = { x: number; y: number };
let noise = 0;
let guard = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function work(i: number): number { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); if (guard > 1e9) return work(i + 1); return (i * 31 + noise) | 0; }
function made(i: number): P { const s = work(i); return { x: s, y: s + 3 }; }
const kept: P[] = [];
const shared: P = { x: 100, y: 200 };
function takes(p: P): number { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); if (guard > 1e9) return takes(p); kept.push(p); return p.x; }

function eitherLiteral(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const s = work(i); const p: P = s & 1 ? { x: s, y: s + 3 } : { x: s + 1, y: 5 }; t = (t + p.x + p.y) | 0; } return t; }
function oneOfThree(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const s = work(i); let p: P; if (i % 3 === 0) p = { x: s, y: 1 }; else if (i % 3 === 1) p = { y: 2, x: -s }; else p = { x: 3, y: s }; t = (t + p.x * 2 + p.y) | 0; } return t; }
function literalOrCall(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? made(i) : { x: i, y: -i }; t = (t + p.x + p.y) | 0; } return t; }
function setAfterwards(n: number): number { let t = 0; for (let i = 0; i < n; i++) { let p: P; if (i & 1) { p = { x: i, y: 0 }; p.y = work(i); } else { p = { x: 0, y: i }; p.x = p.y + 1; } t = (t + p.x + p.y) | 0; } return t; }
function nested(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? (i & 2 ? { x: 1, y: i } : { x: 2, y: i }) : { x: 3, y: i }; t = (t + p.x * p.y) | 0; } return t; }

function isKept(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { x: -i, y: 2 }; kept.push(p); t = (t + p.x) | 0; } return t + kept.length; }
function isPassed(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { x: -i, y: 2 }; t = (t + takes(p) + p.y) | 0; } return t; }
function isWrittenBehindTheJoin(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { x: -i, y: 2 }; p.x += 10; t = (t + p.x + p.y) | 0; } return t; }
function isCompared(n: number): number { let t = 0; let last: P | undefined; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { x: -i, y: 2 }; if (p === last) t += 1000; last = p; t = (t + p.y) | 0; } return t; }
function oneArmIsShared(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : shared; shared.x = i * 7; t = (t + p.x + p.y) | 0; } return t; }
function oneArmIsKeptFirst(n: number): number { let t = 0; for (let i = 0; i < n; i++) { let p: P; if (i & 1) { p = { x: i, y: 1 }; kept.push(p); } else p = { x: -i, y: 2 }; if (kept.length) kept[kept.length - 1].x = 77; t = (t + p.x + p.y) | 0; } return t; }
function oneArmHoldsTheOther(n: number): number { type Q = { x: number; next?: Q }; let t = 0; for (let i = 0; i < n; i++) { const a: Q = { x: i }; const q: Q = i & 1 ? { x: 1, next: a } : { x: 2 }; t = (t + q.x + (q.next ? q.next.x : 0)) | 0; } return t; }
function optionalFields(n: number): string { type O = { a?: number; b?: string }; let out = ""; for (let i = 0; i < n; i++) { const o: O = i & 1 ? { a: i } : { b: "b" + i }; out += o.a + "," + o.b + ";"; } return out; }
function enumerated(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { y: 2, x: -i }; out += Object.keys(p).join("") + JSON.stringify(p); } return out; }
function throwsWhileMaking(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { const p: P = i & 1 ? { x: i, y: i === 3 ? (() => { throw new Error("three"); })() : 1 } : { x: -i, y: 2 }; out += p.x + p.y + ";"; } catch (e) { out += (e as Error).message + ";"; } } return out; }
function carried(n: number): number { let p: P = { x: 0, y: 0 }; for (let i = 0; i < n; i++) p = i & 1 ? { x: p.x + 1, y: p.y } : { x: p.x, y: p.y + 2 }; return p.x * 100 + p.y; }
async function awaitsBetween(n: number): Promise<number> { let t = 0; for (let i = 0; i < n; i++) { const p: P = i & 1 ? { x: i, y: 1 } : { x: -i, y: 2 }; await null; t = (t + p.x + p.y) | 0; } return t; }

const out: unknown[] = [eitherLiteral(30), oneOfThree(30), literalOrCall(30), setAfterwards(30), nested(30)];
out.push(isKept(10), isPassed(10), isWrittenBehindTheJoin(10), isCompared(10), oneArmIsShared(10), oneArmIsKeptFirst(10), oneArmHoldsTheOther(10), optionalFields(4), enumerated(4), throwsWhileMaking(6), carried(9));
guard += out.length > 1e12 ? 1 : 0;
awaitsBetween(6).then(value => { out.push(value, kept.length); for (const line of out) console.log(line); });
