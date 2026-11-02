// Computes NaNs, writes them straight into views over every kind of buffer, hands NaNs read out of views to functions that take any value, and prints the bytes.
const hex = (buffer: ArrayBufferLike, from: number, size: number) =>
  Array.from(new Uint8Array(buffer, from, size), byte => byte.toString(16).padStart(2, "0")).join("");
function report(name: string, view: Float16Array | Float32Array | Float64Array) {
  console.log(name, hex(view.buffer, view.byteOffset, view.BYTES_PER_ELEMENT * 2));
}
const source64 = new Float64Array(
  new BigUint64Array([
    0x7ff8000000001234n,
    0xfff8000000005678n,
    0x7ff0000000000001n,
    0xffffffffffffffffn,
    0xfff8000000000000n,
  ]).buffer,
);
const source32 = new Float32Array(new Uint32Array([0x7fc01234, 0xffc05678, 0x7f800001, 0xffffffff, 0xffc00000]).buffer);

function run(kind: string, make: () => ArrayBufferLike) {
  for (let zero = 0; zero < 1; zero++) {
    const f64 = new Float64Array(make()),
      f32 = new Float32Array(make()),
      f16 = new Float16Array(make());
    f64[zero] = zero / zero;
    f32[zero] = zero / zero;
    f16[zero] = zero / zero;
    f64[zero + 1] = -(zero / zero);
    f32[zero + 1] = -(zero / zero);
    f16[zero + 1] = -(zero / zero);
    report(kind + " 0/0 64", f64);
    report(kind + " 0/0 32", f32);
    report(kind + " 0/0 16", f16);
    f64[zero] = Math.sqrt(zero - 1);
    f32[zero] = Math.sqrt(zero - 1);
    f16[zero] = Math.sqrt(zero - 1);
    f64[zero + 1] = Math.abs(zero / zero);
    f32[zero + 1] = Math.abs(zero / zero);
    f16[zero + 1] = Math.abs(zero / zero);
    report(kind + " sqrt 64", f64);
    report(kind + " sqrt 32", f32);
    report(kind + " sqrt 16", f16);
    const data = new DataView(make());
    data.setFloat64(0, zero / zero, true);
    data.setFloat32(8, zero / zero, true);
    data.setFloat16(12, zero / zero, true);
    data.setFloat64(16, zero / zero);
    data.setFloat32(24, zero / zero);
    data.setFloat16(28, zero / zero);
    console.log(kind, "DataView 0/0", hex(data.buffer, 0, 32));
    f64.fill(zero / zero);
    f32.fill(zero / zero);
    f16.fill(zero / zero);
    report(kind + " fill 64", f64);
    report(kind + " fill 32", f32);
    report(kind + " fill 16", f16);
    f64.fill(source64[1]);
    f32.fill(source64[1]);
    f16.fill(source64[1]);
    report(kind + " fill from view 64", f64);
    report(kind + " fill from view 32", f32);
    report(kind + " fill from view 16", f16);
  }
}
run("fixed", () => new ArrayBuffer(32));
run("resizable", () => new ArrayBuffer(32, { maxByteLength: 64 }));
run("shared", () => new SharedArrayBuffer(32));
run("growable", () => new SharedArrayBuffer(32, { maxByteLength: 64 }));

function subtract(a: number, b: number) {
  return a - b;
}
class Point {
  x: number;
  y?: number;
  constructor(x: number) {
    this.x = x;
  }
}
for (let zero = 0; zero < 1; zero++) {
  const out = new Float64Array(2);
  const point = new Point(zero / zero);
  point.y = zero / zero;
  out[0] = point.x;
  out[1] = point.y;
  report("fields 0/0", out);
  const list = [zero / zero, 1.5];
  out[0] = list[0];
  out[1] = list[1];
  report("arrays", out);
  const bytes = Buffer.alloc(16);
  bytes.writeDoubleLE(zero / zero, 0);
  bytes.writeFloatBE(zero / zero, 8);
  console.log("Buffer", bytes.toString("hex"));
  console.log("slice", hex(source64.slice(1, 3).buffer, 0, 16), hex(source32.subarray(1, 3).slice().buffer, 0, 8));
  console.log("reduce", hex(new Float64Array([source64.reduce((sum, element) => sum + element, 0)]).buffer, 0, 8));
  console.log("at", hex(new Float64Array([source64.at(1)!, source32.at(-1)!]).buffer, 0, 16));

  out[0] = subtract(Infinity, Infinity);
  out[1] = subtract(-Infinity, -Infinity);
  report("operands handed to a function", out);
  out[0] = 0 / 0;
  out[1] = -(0 / 0);
  report("written operands", out);
  out[0] = NaN;
  out[1] = -NaN;
  report("written", out);
  const whole = zero | 0;
  out[0] = whole % whole;
  out[1] = (whole + 7) % whole;
  report("a remainder of integers", out);
}
