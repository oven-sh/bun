// A loop that reads and stores views only where a flag says so. What the loop reads of a view beside its elements (where they lie, how many there are, whether the length is fixed) stays the same while it runs,
// unless the loop itself calls code that takes the buffer away or changes its size: then each turn sees the view as it is.
function gather(a: Float64Array, b: Float64Array, c: Uint8Array, n: number): void {
  for (let i = 0; i < n; i++) { if (c[i] !== 0) a[i] = b[i] * 2; }
}
function gatherAndTell(a: Float64Array, b: Float64Array, c: Uint8Array, n: number, tell: (i: number) => void): number {
  let seen = 0;
  for (let i = 0; i < n; i++) { if (c[i] !== 0) { tell(i); const v = b[i]; a[i] = v * 2; seen += v === undefined ? 100 : 1; } }
  return seen;
}
function pickSum(b: number[], c: number[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) { if (c[i] > 0.5) s += b[i]; }
  return s;
}
class Samples extends Float64Array { get first(): number { return this[0]; } }

const size: number = JSON.parse("64");
const source = new Float64Array(64), target = new Float64Array(64), flags = new Uint8Array(64);
const weights: number[] = [], marks: number[] = [];
for (let i = 0; i < 64; ++i) { source[i] = i * 1.5; flags[i] = i & 1; weights.push(i + 0.25); marks.push((i & 1) + 0.25); }
let total = 0;
for (let turn = 0; turn < 5000; ++turn) { gather(target, source, flags, size); total += pickSum(weights, marks, size) + gatherAndTell(target, source, flags, size, () => {}); }
console.log(total, target.join());

// No flag is set: nothing of the two views is asked, whatever they are
gather(new Float64Array(0), new Float64Array(0), new Uint8Array(64), size);
const gone = new Float64Array(8); structuredClone(gone.buffer, { transfer: [gone.buffer] });
gather(gone, gone, new Uint8Array(64), size);
gather(gone, gone, flags, size);
console.log(gone.length);

// Shorter than the flags, an instance of a class below, a view into the middle of a buffer
const short = new Float64Array(5); gather(short, source, flags, size); console.log(short.join());
const samples = new Samples(8); gather(samples, source, flags, size); console.log(samples.join(), samples.first);
const middle = new Float64Array(source.buffer.slice(0), 16, 4); gather(target, middle, flags, size); console.log(target.slice(0, 8).join());

// The buffer shrinks, grows and goes away while the loop runs
const resizable = new ArrayBuffer(64 * 8, { maxByteLength: 128 * 8 });
const tracking = new Float64Array(resizable); tracking.fill(3);
console.log(gatherAndTell(target, tracking, flags, size, i => { if (i === 9) resizable.resize(16 * 8); if (i === 41) resizable.resize(128 * 8); }), tracking.length, target.slice(0, 48).join());
const leaving = new Float64Array(64).fill(5);
console.log(gatherAndTell(target, leaving, flags, size, i => { if (i === 5) structuredClone(leaving.buffer, { transfer: [leaving.buffer] }); }), leaving.length, target.slice(0, 12).join());
const receiving = new Float64Array(64);
console.log(gatherAndTell(receiving, source, flags, size, i => { if (i === 7) structuredClone(receiving.buffer, { transfer: [receiving.buffer] }); }), receiving.length);
