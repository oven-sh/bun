const bytes = new Uint8Array([1, 2, 3]);
Object.assign(bytes, { 0: 300, 1: "7" });
console.log(bytes.map(n => n + 1).join(), bytes[0] + 1, typeof bytes[1]);

const floats = new Float64Array([1, 2]);
Object.assign(floats, { 0: 2.5, 1: "x" });
console.log(floats[0] + 1, floats[1] + 1);
