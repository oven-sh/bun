// Computes NaNs and writes them by index into Float16Array, Float32Array and Float64Array over every kind of buffer, and prints the bytes.
const hex = (buffer: ArrayBufferLike) =>
  Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");

function subtract(a: number, b: number) {
  return a - b;
}

function write(kind: string, make: () => ArrayBufferLike) {
  for (let zero = 0; zero < 1; zero++) {
    const whole = zero | 0;
    for (const offset of [0, 8]) {
      const f64 = new Float64Array(make(), offset),
        f32 = new Float32Array(make(), offset),
        f16 = new Float16Array(make(), offset);
      f64[zero] = zero / zero;
      f32[zero] = zero / zero;
      f16[zero] = zero / zero;
      f64[zero + 1] = -(zero / zero);
      f32[zero + 1] = -(zero / zero);
      f16[zero + 1] = -(zero / zero);
      f64[zero + 2] = Math.sqrt(zero - 1);
      f32[zero + 2] = Math.sqrt(zero - 1);
      f16[zero + 2] = Math.sqrt(zero - 1);
      console.log(kind, offset, "quotients and a root", hex(f64.buffer), hex(f32.buffer), hex(f16.buffer));
      f64[zero] = Math.abs(zero / zero);
      f32[zero] = Math.abs(zero / zero);
      f16[zero] = Math.abs(zero / zero);
      f64[zero + 1] = whole % whole;
      f32[zero + 1] = whole % whole;
      f16[zero + 1] = whole % whole;
      f64[zero + 2] = Math.sign(zero / zero);
      f32[zero + 2] = Math.sign(zero / zero);
      f16[zero + 2] = Math.sign(zero / zero);
      console.log(kind, offset, "a size, a remainder and a sign", hex(f64.buffer), hex(f32.buffer), hex(f16.buffer));
      f64[zero] = subtract(Infinity, Infinity);
      f32[zero] = subtract(Infinity, Infinity);
      f16[zero] = subtract(Infinity, Infinity);
      f64[zero + 1] = NaN;
      f32[zero + 1] = NaN;
      f16[zero + 1] = NaN;
      f64[zero + 2] /= zero;
      f32[zero + 2] /= zero;
      f16[zero + 2] /= zero;
      console.log(kind, offset, "a difference and what is written", hex(f64.buffer), hex(f32.buffer), hex(f16.buffer));
    }
    const part64 = new Float64Array(make(), 8, 1),
      part32 = new Float32Array(make(), 8, 1),
      part16 = new Float16Array(make(), 8, 1);
    part64[zero] = zero / zero;
    part32[zero] = zero / zero;
    part16[zero] = zero / zero;
    part64[zero + 1] = zero / zero;
    part32[zero + 1] = zero / zero;
    part16[zero + 1] = zero / zero;
    console.log(kind, "a part of one element", hex(part64.buffer), hex(part32.buffer), hex(part16.buffer));
  }
}

write("fixed", () => new ArrayBuffer(32));
write("resizable", () => new ArrayBuffer(32, { maxByteLength: 64 }));
write("resized", () => {
  const buffer = new ArrayBuffer(8, { maxByteLength: 64 });
  buffer.resize(32);
  return buffer;
});
write("shared", () => new SharedArrayBuffer(32));
write("growable", () => new SharedArrayBuffer(32, { maxByteLength: 64 }));
write("grown", () => {
  const buffer = new SharedArrayBuffer(8, { maxByteLength: 64 });
  buffer.grow(32);
  return buffer;
});

for (let zero = 0; zero < 1; zero++) {
  const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
  const part = new Float64Array(buffer, 16, 2),
    tail = new Float32Array(buffer, 16),
    halves = new Float16Array(buffer, 24);
  buffer.resize(8);
  part[zero] = zero / zero;
  tail[zero] = zero / zero;
  halves[zero] = zero / zero;
  console.log("outside a buffer that shrank", part.length, tail.length, halves.length, hex(buffer));
  buffer.resize(32);
  console.log("when it has grown again", part.length, tail.length, halves.length, hex(buffer));
  part[zero] = zero / zero;
  tail[zero + 2] = zero / zero;
  halves[zero + 3] = zero / zero;
  console.log("written then", hex(buffer));
}
