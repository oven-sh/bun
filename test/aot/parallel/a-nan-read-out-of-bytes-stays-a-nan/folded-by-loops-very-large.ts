// Flags: --aot-limit=MaxWarmCodeValues:1
const patterns: bigint[] = [
  0xfffe000000000002n,
  0xfffe000000000006n,
  0xfffe000000000007n,
  0xfffe00000000000an,
  0xfffe00000000002an,
  0xfffe000012345678n,
  0xfffe7fffffffffffn,
  0xffff000000000001n,
  0xffffffffffffffffn,
  0xfffc000012345678n,
  0xfffd000000000000n,
  0xfff8000000000001n,
  0x7ff8000000000007n,
  0x7ff0000000000001n,
  0x7fffffffffffffffn,
  0x7ffa000000000000n,
  0x7ffb000000000000n,
  0x7ffc000000000000n,
];
const bits = new BigUint64Array(patterns.length);
for (let i = 0; i < patterns.length; i++) bits[i] = patterns[i];
const doubles = new Float64Array(bits.buffer);
const view = new DataView(bits.buffer);
const words = new Uint32Array([
  0x7fc00001, 0xffc00007, 0x7f800001, 0xffffffff, 0xff800001, 0x7fffffff, 0x7fd00000, 0x7fd80000, 0x7fe00000,
  0xfff00000, 0xffe00000,
]);
const floats = new Float32Array(words.buffer);
const out: string[] = [];
function tell(v: unknown): string {
  const a: any = v;
  let text =
    typeof v +
    ":" +
    String(v) +
    ":" +
    (v === v) +
    ":" +
    Object.is(v, NaN) +
    ":" +
    JSON.stringify([v]) +
    ":" +
    (a | 0) +
    ":" +
    (v == null) +
    ":" +
    (v ? 1 : 0);
  try {
    text += ":" + String(a.constructor === Number) + ":" + String(a.x);
  } catch (e) {
    text += ":threw";
  }
  return text;
}
const nobody: { see(v: unknown): void } = { see() {} };
process.emit((process.env.EVENT ?? "nothing") as any, nobody as any);

function sum(L: Float64Array | Float32Array): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += L[i];
  return s;
}
function product(L: Float64Array): number {
  let s = 1;
  for (let i = 0; i < L.length; i++) s *= L[i];
  return s;
}
function greatest(L: Float64Array): number {
  let s = -Infinity;
  for (let i = 0; i < L.length; i++) s = Math.max(s, L[i]);
  return s;
}
function least(L: Float32Array): number {
  let s = Infinity;
  for (let i = 0; i < L.length; i++) s = Math.min(s, L[i]);
  return s;
}
function last(L: Float64Array): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s = L[i];
  return s;
}
function dot(L: Float64Array, M: Float64Array): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += L[i] * M[i];
  return s;
}
function scaled(L: Float64Array, M: Float64Array): void {
  for (let i = 0; i < L.length; i++) M[i] = L[i] * 2 + 1;
}
function toList(L: Float64Array): number[] {
  const list: number[] = [];
  for (let i = 0; i < L.length; i++) list.push(L[i]);
  return list;
}
function toListByIndex(L: Float32Array): number[] {
  const list: number[] = new Array(L.length);
  for (let i = 0; i < L.length; i++) list[i] = L[i];
  return list;
}
for (let round = 0; round < 3; round++) {
  out.length = 0;
  for (let p = 0; p < patterns.length; p++) {
    const b = new BigUint64Array(96);
    for (let i = 0; i < 96; i++) b[i] = 0x3ff0000000000000n;
    b[(p * 3) % 96] = patterns[p];
    b[95 - p] = patterns[(p + 1) % patterns.length];
    const L = new Float64Array(b.buffer),
      F = new Float32Array(b.buffer),
      M = new Float64Array(96).fill(1);
    out.push(
      tell(sum(L)) +
        tell(sum(F)) +
        tell(product(L)) +
        tell(greatest(L)) +
        tell(least(F)) +
        tell(last(L.subarray(0, ((p * 3) % 96) + 1))) +
        tell(dot(L, M)),
    );
    scaled(L, M);
    out.push(
      tell(M[(p * 3) % 96]) +
        toList(L).map(tell).join().length +
        tell(toList(L)[(p * 3) % 96]) +
        tell(toListByIndex(F)[((p * 3) % 96) * 2 + 1]) +
        toList(L).includes(NaN) +
        JSON.stringify(toList(L)).length,
    );
  }
}
console.log(out.join("\n"));
