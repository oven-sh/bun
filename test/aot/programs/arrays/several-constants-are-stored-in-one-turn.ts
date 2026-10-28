// One turn of a loop stores several constants, each into a view of its own, or computes with several.
function two(length: number): string {
  const v = new Int32Array(length), w = new Int32Array(length);
  for (let k = 0; k < v.length; k++) { v[k] = 7; w[k] = 9; }
  return v.join() + " " + w.join();
}
function three(length: number): string {
  const v = new Uint32Array(length), w = new Uint32Array(length), x = new Uint32Array(length);
  for (let k = 0; k < v.length; k++) { v[k] = 0x01020304; w[k] = 0xfffefdfc; x[k] = 12345; }
  return v.join() + " " + w.join() + " " + x.join();
}
function bytes(length: number): string {
  const v = new Uint8Array(length), w = new Uint8Array(length);
  for (let k = 0; k < v.length; k++) { v[k] = 200; w[k] = 3; }
  return v.join() + " " + w.join();
}
function numbers(length: number): string {
  const v = new Float64Array(length), w = new Float64Array(length).fill(2);
  for (let k = 0; k < v.length; k++) { v[k] = 0.1; w[k] = w[k]! * 1.0625 + 0.3; }
  return v.join() + " " + w.join();
}
function singles(length: number): string {
  const v = new Float32Array(length).fill(1.25), w = new Float32Array(length).fill(-7);
  for (let k = 0; k < v.length; k++) { v[k] = -v[k]! * 1.5; w[k] = Math.abs(w[k]!) - 2.25; }
  return v.join() + " " + w.join();
}
function masked(length: number): string {
  const v = Int16Array.from({ length }, (_, k) => k * 517);
  for (let k = 0; k < v.length; k++) v[k] = ((v[k]! & 0x0ff0) | 0x1001) ^ 0x0a0a;
  return v.join();
}

for (const length of [0, 1, 3, 8, 9, 17, 33, 70]) console.log(length, two(length), three(length), bytes(length), numbers(length), singles(length), masked(length));
