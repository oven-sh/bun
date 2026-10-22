const first = new ArrayBuffer(8, { maxByteLength: 16 });
const second = new DataView(new ArrayBuffer(16));
const result = Bun.randomUUIDv5(first, second, 3.5);
console.log(typeof result, result.length, result);
