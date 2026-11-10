const table = {
  differ(a: Int8Array | Int16Array, b: Float32Array | Float64Array) { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] - b[i]; return sum; },
  other(a: Int8Array | Int16Array, b: Float32Array | Float64Array) { let sum = 0; for (let i = 0; i < b.length; i++) sum += a[i] * b[i]; return sum; },
};
type Name = keyof typeof table;
const names = JSON.parse('["differ","other"]') as Name[];
for (const name of names) for (const length of [0, 1, 3, 4, 7, 8, 9, 33]) {
  console.log(name, length, table[name](new Int8Array(length).fill(7), new Float32Array(length).fill(2)), table[name](new Int16Array(length).fill(-300), new Float64Array(length).fill(0.25)), table[name](new Int16Array(length).fill(5), new Float32Array(length + 2).fill(0.5)), table[name](new Int8Array(length + 1).fill(5), new Float64Array(length).fill(1.5)));
}
