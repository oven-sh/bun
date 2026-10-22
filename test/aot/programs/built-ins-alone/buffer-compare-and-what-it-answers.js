const first = new DataView(new ArrayBuffer(16));
const second = new DataView(new ArrayBuffer(16));
const result = Buffer.compare(first, second);
console.log(typeof result, result + 1, 1 / result);
