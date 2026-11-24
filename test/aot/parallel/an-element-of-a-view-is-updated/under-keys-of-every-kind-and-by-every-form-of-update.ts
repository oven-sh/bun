// An update of an element of a view (`v[k]++`, `v[k] += n`, `v[k] = v[k] * 2`) reads and stores at one key. The key, the view and the bound are asked once, and the store rests on what the read has asked.
function show(v: ArrayLike<number> & object): string { return Array.prototype.join.call(v, ",") + " " + Object.keys(v).join("|") + " " + String((v as any).undefined) + " " + String((v as any)["-1"]) + " " + String((v as any)["1.5"]); }
class Machine {
  readonly mem = new Uint8Array(6); readonly counts = new Uint32Array(4); readonly signed = new Int8Array(4); readonly halves = new Float64Array(4); readonly clamped = new Uint8ClampedArray(4); pc = 0;
  step(): void { const op = this.mem[this.pc++]!; this.counts[op]!++; }
  add(n: number): void { const op = this.mem[this.pc++]!; this.signed[op]! += n; }
  twice(): void { const op = this.mem[this.pc++]!; this.halves[op] = this.halves[op]! * 2 + 0.5; }
  down(): void { const op = this.mem[this.pc++]!; this.clamped[op]!--; }
  before(): number { const op = this.mem[this.pc++]!; return this.counts[op]!++; }
  behind(): number { const op = this.mem[this.pc++]!; return ++this.counts[op]!; }
  other(): void { const op = this.mem[this.pc++]!; this.counts[op] = this.signed[op]! + 1; }
  next(): void { const op = this.mem[this.pc++]!; this.counts[op + 1] = this.counts[op]! + 1; }
}
function at(v: Uint32Array, k: number): void { v[k]!++; }
function any(v: Uint32Array, k: any): void { v[k]++; }
function shrinks(v: Uint8Array, k: number, buffer: ArrayBuffer): void { v[k] = v[k]! + (buffer.resize(1), 1); }
function text(v: Uint32Array, k: number, n: any): void { v[k]! += n; }
const m = new Machine(); m.mem.set([0, 3, 3, 4, 255, 1]);
function tell(name: string, said: string): void { console.log(name, said, m.pc, show(m.counts), "/", show(m.signed), "/", show(m.halves), "/", show(m.clamped)); }
let said = "";
m.pc = 0; for (let i = 0; i < 9; i++) m.step(); tell("step", "");
m.pc = 0; for (let i = 0; i < 9; i++) m.add(100); tell("add", "");
m.pc = 0; for (let i = 0; i < 9; i++) m.twice(); tell("twice", "");
m.pc = 0; for (let i = 0; i < 9; i++) m.down(); tell("down", "");
m.pc = 0; said = ""; for (let i = 0; i < 9; i++) said += m.before() + ","; tell("before", said);
m.pc = 0; said = ""; for (let i = 0; i < 9; i++) said += m.behind() + ","; tell("behind", said);
m.pc = 0; for (let i = 0; i < 9; i++) m.other(); tell("other", "");
m.pc = 0; for (let i = 0; i < 9; i++) m.next(); tell("next", "");
const v = new Uint32Array(3);
for (const k of [0, 2, 3, -1, 1.5, NaN, -0, 4294967295, 4294967296, Infinity]) at(v, k);
console.log(show(v));
for (const k of [0, "1", "x", undefined, null, true, 2n, { valueOf() { return 2; } }, { toString() { return "2"; } }, Symbol.iterator]) { try { any(v, k); } catch (e) { console.log((e as Error).name); } }
console.log(show(v), String((v as any).x), String((v as any).null), String((v as any).true));
const buffer = new ArrayBuffer(4, { maxByteLength: 8 }), tracking = new Uint8Array(buffer);
shrinks(tracking, 0, buffer); buffer.resize(4); shrinks(tracking, 3, buffer); console.log(show(tracking), tracking.length);
for (const n of [1, "7", 0.5, -1, NaN, { valueOf() { v[1] = 50; return 2; } }]) text(v, 1, n);
try { text(v, 1, 2n); } catch (e) { console.log((e as Error).name); }
console.log(show(v));
