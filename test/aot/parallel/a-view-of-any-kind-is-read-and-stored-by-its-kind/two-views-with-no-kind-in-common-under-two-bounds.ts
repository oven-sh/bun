type Floats = Float32Array | Float64Array;
type Words = Int32Array | Uint32Array;
const tools = {
  go(a: Floats, b: Words) { let sum = 0; for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] - b[i]; return sum; },
} as Record<string, (...values: any[]) => number>;
const call = (name: string, ...values: unknown[]) => tools[JSON.parse(JSON.stringify(name))](...values);
for (const n of [0, 1, 3, 4, 5, 8, 9, 17, 40]) console.log(
  call("go", new Float64Array(n).fill(1.5), new Int32Array(n).fill(-7)), call("go", new Float32Array(n).fill(0.25), new Uint32Array(n).fill(4294967295)),
  call("go", new Float64Array(n).fill(-2.5), new Uint32Array(n).fill(9)), call("go", new Float32Array(n).fill(3), new Int32Array(n + 2).fill(5)));
