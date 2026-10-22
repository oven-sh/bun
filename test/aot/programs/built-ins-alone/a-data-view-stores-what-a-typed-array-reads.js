const buffer = new ArrayBuffer(8);
const floats = new Float64Array(buffer);
console.log(floats[0]);
new DataView(buffer).setFloat64(0, 2.5, true);
console.log(floats[0] + 1);
