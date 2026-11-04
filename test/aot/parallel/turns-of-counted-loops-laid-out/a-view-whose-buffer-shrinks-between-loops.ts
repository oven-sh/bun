function run(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i] + 1; return t; }
const buffer = new ArrayBuffer(40, { maxByteLength: 80 }); const view = new Uint8Array(buffer);
console.log(run(view));
console.log((buffer.resize(19), run(view)));
console.log((buffer.resize(72), run(view)));
console.log((buffer.resize(0), run(view)));
