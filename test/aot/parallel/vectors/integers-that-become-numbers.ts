// Loops that read integers or their own index and store numbers, two elements a vector.
const B = new DataView(new ArrayBuffer(8));
function show(v: ArrayLike<number>) {
  let t = 17;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x !== x) { t = (Math.imul(t, 31) + 7) | 0; continue; }
    B.setFloat64(0, x);
    t = (Math.imul(t, 31) + B.getInt32(0)) | 0;
    t = (Math.imul(t, 31) + B.getInt32(4)) | 0;
  }
  return v.length + ":" + t;
}
function fromInt8(a: Int8Array, o: Float32Array) { for (let i = 0; i < a.length; i++) o[i] = a[i] / 128; }
function fromUint8(a: Uint8Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = a[i] * 0.5 - 3; }
function fromInt16(a: Int16Array, o: Float32Array) { for (let i = 0; i < a.length; i++) o[i] = a[i] / 32768; }
function fromUint16(a: Uint16Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = 1 / a[i]; }
function fromInt32(a: Int32Array, o: Float64Array, k: number) { for (let i = 0; i < a.length; i++) o[i] = a[i] * k; }
function ramp(o: Float64Array, k: number) { for (let i = 0; i < o.length; i++) o[i] = i * k + 0.5; }
function rampDown(o: Float32Array, from: number) { let j = from; for (let i = 0; i < o.length; i++) { o[i] = j * 0.25; j -= 3; } }
function sumOfThree(a: Int16Array, b: Uint8Array, o: Float32Array, n: number) { for (let i = 0; i < n; i++) o[i] = a[i] * 0.5 + b[i] + i; }
for (const n of [0, 1, 15, 16, 17, 31, 40, 71]) {
  const fill = (v: any) => { for (let i = 0; i < v.length; i++) v[i] = i * 92821 - 70000 + (i & 3 ? 0 : -i); return v; };
  const f = new Float32Array(n), d = new Float64Array(n), answers: string[] = [];
  fromInt8(fill(new Int8Array(n)), f); answers.push(show(f));
  fromUint8(fill(new Uint8Array(n)), d); answers.push(show(d));
  fromInt16(fill(new Int16Array(n)), f); answers.push(show(f));
  fromUint16(fill(new Uint16Array(n)), d); answers.push(show(d));
  fromInt32(fill(new Int32Array(n)), d, -7); answers.push(show(d));
  fromInt32(fill(new Int32Array(n)), d, 0.1); answers.push(show(d));
  ramp(d, 3); answers.push(show(d));
  ramp(d, -0.75); answers.push(show(d));
  rampDown(f, 1000); answers.push(show(f));
  sumOfThree(fill(new Int16Array(n)), fill(new Uint8Array(n)), f, n); answers.push(show(f));
  sumOfThree(fill(new Int16Array(n)), fill(new Uint8Array(n >> 1)), f, n); answers.push(show(f));
  sumOfThree(fill(new Int16Array(n)), fill(new Uint8Array(n)), f, n + 5); answers.push(show(f));
  const buffer = new ArrayBuffer(8 * n + 64);
  for (const offset of [0, 4, 8, 16, 60]) {
    fill(new Int16Array(buffer)); fromInt16(new Int16Array(buffer, 0, n), new Float32Array(buffer, offset, n)); answers.push(show(new Uint8Array(buffer)));
    fill(new Uint8Array(buffer)); fromUint8(new Uint8Array(buffer, offset, n), new Float64Array(buffer, 0, n)); answers.push(show(new Uint8Array(buffer)));
  }
  console.log(n, answers.join(" "));
}
