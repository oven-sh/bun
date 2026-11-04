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

const buffer = Buffer.from(bits.buffer);
const halves: any =
  typeof (globalThis as any).Float16Array === "function"
    ? new (globalThis as any).Float16Array(new Uint16Array([0x7c01, 0xffff, 0x7e00, 0xfe01, 0x7fff, 0xfc01]).buffer)
    : [];
function road(i: number): string {
  const a = buffer.readDoubleLE(i * 8),
    b = buffer.readDoubleBE(i * 8),
    c = buffer.readFloatLE(i * 8 + 4),
    d = buffer.readFloatBE(i * 8);
  const o = { a, b, c, d };
  nobody.see(o);
  return tell(a) + tell(b) + tell(c) + tell(d) + tell(o.a) + tell(o.b) + tell(o.c) + tell(o.d);
}
function half(i: number): string {
  const v = halves[i];
  const o = { v };
  nobody.see(o);
  return tell(v) + tell(o.v) + tell(v + 0) + tell(Math.fround(v));
}
for (let round = 0; round < 3; round++) {
  out.length = 0;
  for (let i = 0; i < doubles.length; i++) out.push(road(i));
  for (let i = 0; i < halves.length; i++) out.push(half(i));
}
console.log(out.join("\n"));
