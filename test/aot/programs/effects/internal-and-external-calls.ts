// Side effects of calls between the program's own functions and of calls that leave the program.
let counter = 0
function bump(k: number): number { if (k > 0) return bump(k - 1); counter++; return counter }
function aroundBump(): number { const before = counter; bump(3); return before * 100 + counter }
console.log(aroundBump(), aroundBump())

class P { x = 1; y = 2 }
function setX(p: P, k: number): void { if (k > 0) return setX(p, k - 1); p.x = p.x + 5 }
function aroundSetX(p: P): number { const before = p.x; setX(p, 2); return before * 100 + p.x }
const p0 = new P()
console.log(aroundSetX(p0), aroundSetX(p0))

let shared = 0
const unknown: any = () => { shared++ }
function aroundUnknown(): number { const before = shared; unknown(); return before * 100 + shared }
console.log(aroundUnknown(), aroundUnknown())

let converted = 0
const convertible: any = { valueOf() { converted++; return 1.5 } }
function aroundConversion(): number { const before = converted; const f = Math.floor(convertible); return before * 100 + converted * 10 + f }
console.log(aroundConversion(), aroundConversion())

function make(k: number): P { if (k > 0) return make(k - 1); const p = new P(); p.x = 9; return p }
function aroundMake(p: P): number { const before = p.x; const q = make(2); return before * 10000 + p.x * 100 + q.x }
console.log(aroundMake(p0))

function pure(a: number, k: number): number { return k > 0 ? pure(a + 1, k - 1) : a }
function aroundPure(p: P): number { const before = p.y; const r = pure(1, 3); return before * 100 + p.y * 10 + r }
console.log(aroundPure(p0))

// The object is handed to code outside, which hands it to a function of the program that changes it.
class Q { z = 1 }
const q0 = new Q()
const changer: any = (q: Q) => { q.z = q.z + 1 }
function aroundChanger(q: Q): number { const before = q.z; changer(q); return before * 100 + q.z }
console.log(aroundChanger(q0), aroundChanger(q0))

// A store before a call that throws is visible in the handler.
let stage = 0
function fails(k: number): number { if (k > 0) return fails(k - 1); throw new Error("no") }
function aroundFailure(): number { try { stage = 1; fails(2); stage = 2 } catch { return stage * 10 } return stage }
console.log(aroundFailure())

class G { n = 0; get next(): number { this.n = this.n + 1; return this.n } set to(v: number) { this.n = v } }
function aroundAccessors(g: G): number { const a = g.n; const b = g.next; const c = g.n; g.to = 7; return a * 1000 + b * 100 + c * 10 + g.n }
console.log(aroundAccessors(new G()))

// A function outside code runs reads what was stored just before.
let written = 0
const reader: any = () => written
function aroundReader(v: number): number { written = v; return reader() }
console.log(aroundReader(5), aroundReader(6))

// A function of the program that changes something only through a function value.
let viaValue = 0
const steps = [() => { viaValue += 1 }, () => { viaValue += 10 }]
function runStep(i: number, k: number): void { if (k > 0) return runStep(i, k - 1); steps[i]!() }
function aroundStep(): number { const before = viaValue; runStep(0, 1); runStep(1, 1); return before * 1000 + viaValue }
console.log(aroundStep(), aroundStep())

function remainders(a: number, b: number): string { return [a % 3, a % -3, (a | 0) % 7, b % 5, (b | 0) % -1, (a | 0) % ((b | 0) || 1)].map(v => Object.is(v, -0) ? "-0" : String(v)).join(",") }
console.log(remainders(-7, 10), remainders(7, -10), remainders(-6, 0), remainders(2147483647, -2147483648))
let total = 0
for (let i = 0; i < 4; i++) total += Math.pow(2, 10) + (10.5 % 4) + (("5" as any) | 0)
console.log(total)

// State that no function reachable from outside code touches is unchanged across a call that leaves the program.
class R { v = 3 }
const noop: any = () => {}
function aroundNoop(r: R): number { const before = r.v; noop(); return before * 10 + r.v }
console.log(aroundNoop(new R()))
