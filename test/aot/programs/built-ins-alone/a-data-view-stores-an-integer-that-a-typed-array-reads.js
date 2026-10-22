const buffer = new ArrayBuffer(4);
const view = new Int32Array(buffer);
console.log(view[0]);
new DataView(buffer).setInt32(0, -5, true);
console.log(view[0] + 1);
