const patterns = [
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
const words = new Uint32Array([0x7fc00001, 0xffc00007, 0x7f800001, 0xffffffff, 0xff800001, 0x7fffffff]);
const floats = new Float32Array(words.buffer);
const out = [];
function tell(v) {
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
    (v | 0) +
    ":" +
    (v == null) +
    ":" +
    (v ? 1 : 0);
  try {
    text += ":" + String(v.constructor === Number) + ":" + String(v.x);
  } catch (e) {
    text += ":threw";
  }
  return text;
}
function* gen(L, i) {
  const v = L[i];
  yield 1;
  yield v;
}
function road(L, i) {
  const g = gen(L, i);
  g.next();
  return tell(g.next().value);
}
for (let round = 0; round < 3; round++) {
  out.length = 0;
  for (let i = 0; i < doubles.length; i++) out.push(road(doubles, i));
  for (let i = 0; i < floats.length; i++) out.push(road(floats, i));
}
console.log(out.join("\n"));
