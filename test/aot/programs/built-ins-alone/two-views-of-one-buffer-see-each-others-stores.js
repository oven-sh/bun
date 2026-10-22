const buffer = new ArrayBuffer(8);
const floats = new Float64Array(buffer);
const view = new Uint8Array(buffer);
console.log(view[7]);
floats[0] = 1.5;
console.log(view[7], view[6]);
view[7] = 64;
console.log(floats[0]);
