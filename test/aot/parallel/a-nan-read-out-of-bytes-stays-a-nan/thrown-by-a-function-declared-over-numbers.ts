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
function deep(v: number, n: number): number {
  if (n === 0) {
    if (new Error("x").stack!.length > 0) return v;
    return 0;
  }
  return deep(v, n - 1);
}
function thrower(v: number): never {
  throw v;
}
function road(x: number): string {
  let text = tell(deep(x, 3));
  try {
    thrower(x);
  } catch (e) {
    text += tell(e);
  }
  try {
    const kept: number = x;
    nobody.see(1);
    (null as any).y;
    text += kept;
  } catch (e) {
    text += "caught";
  }
  return text;
}
for (let round = 0; round < 3; round++) {
  out.length = 0;
  for (let i = 0; i < doubles.length; i++) out.push(road(doubles[i]));
  for (let i = 0; i < floats.length; i++) out.push(road(floats[i]));
  for (let i = 0; i < doubles.length; i++)
    out.push(
      road(view.getFloat64(i * 8, true)) + road(view.getFloat32(i * 8 + 4, true)) + road(view.getFloat64(i * 8, false)),
    );
}
console.log(out.join("\n"));
