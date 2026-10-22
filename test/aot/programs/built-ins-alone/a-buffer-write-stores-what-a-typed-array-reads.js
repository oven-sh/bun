const buffer = new ArrayBuffer(8);
const floats = new Float64Array(buffer);
console.log(floats[0]);
Buffer.from(buffer).writeDoubleLE(2.5, 0);
console.log(floats[0] + 1);
