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

function road(L: Float64Array, i: number): string {
  const any: any = L;
  const [first, second] = L;
  const it = L.values();
  it.next();
  let text =
    tell(any[String(i)]) +
    tell(Reflect.get(L, i)) +
    tell(Object.values(L)[i]) +
    tell(Object.entries(L)[i][1]) +
    tell(first) +
    tell(second) +
    tell(it.next().value) +
    tell(L.at(i)) +
    tell(L.at(-1));
  for (const k in L) if (Number(k) === i) text += tell(any[k]);
  text +=
    tell(Array.prototype.slice.call(L)[i]) +
    tell(Array.from(L)[i]) +
    tell(Array.from(L, v => v)[i]) +
    tell([...L][i]) +
    tell(Array.of(...L)[i]) +
    tell(new Array(...L)[i]) +
    tell(Array.prototype.map.call(L, v => v)[i]) +
    tell(Array.prototype.concat.call([], Array.from(L))[i]);
  const pushed: number[] = [];
  pushed.push(...L);
  text += tell(pushed[i]);
  text +=
    tell(L.toReversed()[L.length - 1 - i]) +
    tell(L.with(0, 1)[i]) +
    tell(L.map(v => v)[i]) +
    tell(L.filter(() => true)[i]) +
    tell(L.slice()[i]) +
    tell(L.subarray(i)[0]) +
    tell(L.findLast((v, k) => k === i)) +
    tell(L.reduceRight((a, v, k) => (k === i ? v : a), 0)) +
    L.includes(NaN) +
    L.indexOf(NaN) +
    L.some(v => v === v) +
    L.every(v => v !== v) +
    tell(Math.max(...L)) +
    tell(Math.min.apply(null, any)) +
    tell(Object.getOwnPropertyDescriptor(L, i)!.value) +
    tell(structuredClone(L)[i]) +
    L.toString().length +
    L.toLocaleString().length +
    tell(L.toSorted()[L.length - 1]);
  const target = new Float64Array(L.length);
  target.set(L);
  text += tell(target[i]);
  const narrow = new Float32Array(L);
  text += tell(narrow[i]);
  const wide = Float64Array.from(L);
  text += tell(wide[i]) + tell(new Float64Array(Array.from(L))[i]);
  return text;
}
function roadOfFloats(L: Float32Array, i: number): string {
  const any: any = L;
  const [first, second] = L;
  const it = L.values();
  it.next();
  let text =
    tell(any[String(i)]) +
    tell(Reflect.get(L, i)) +
    tell(Object.values(L)[i]) +
    tell(Object.entries(L)[i][1]) +
    tell(first) +
    tell(second) +
    tell(it.next().value) +
    tell(L.at(i)) +
    tell(L.at(-1));
  for (const k in L) if (Number(k) === i) text += tell(any[k]);
  text +=
    tell(Array.prototype.slice.call(L)[i]) +
    tell(Array.from(L)[i]) +
    tell(Array.from(L, v => v)[i]) +
    tell([...L][i]) +
    tell(Array.of(...L)[i]) +
    tell(new Array(...L)[i]) +
    tell(Array.prototype.map.call(L, v => v)[i]) +
    tell(Array.prototype.concat.call([], Array.from(L))[i]);
  const pushed: number[] = [];
  pushed.push(...L);
  text += tell(pushed[i]);
  text +=
    tell(L.toReversed()[L.length - 1 - i]) +
    tell(L.with(0, 1)[i]) +
    tell(L.map(v => v)[i]) +
    tell(L.filter(() => true)[i]) +
    tell(L.slice()[i]) +
    tell(L.subarray(i)[0]) +
    tell(L.findLast((v, k) => k === i)) +
    tell(L.reduceRight((a, v, k) => (k === i ? v : a), 0)) +
    L.includes(NaN) +
    L.indexOf(NaN) +
    L.some(v => v === v) +
    L.every(v => v !== v) +
    tell(Math.max(...L)) +
    tell(Math.min.apply(null, any)) +
    tell(Object.getOwnPropertyDescriptor(L, i)!.value) +
    tell(structuredClone(L)[i]) +
    L.toString().length +
    L.toLocaleString().length +
    tell(L.toSorted()[L.length - 1]);
  const target = new Float64Array(L.length);
  target.set(L);
  text += tell(target[i]);
  const narrow = new Float32Array(L);
  text += tell(narrow[i]);
  const wide = Float64Array.from(L);
  text += tell(wide[i]) + tell(new Float64Array(Array.from(L))[i]);
  return text;
}
for (let round = 0; round < 3; round++) {
  out.length = 0;
  for (let i = 0; i < doubles.length; i++) out.push(road(doubles, i));
  for (let i = 0; i < floats.length; i++) out.push(roadOfFloats(floats, i));
}
console.log(out.join("\n"));
