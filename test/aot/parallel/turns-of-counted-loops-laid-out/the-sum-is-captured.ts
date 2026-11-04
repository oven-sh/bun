function run(view: Uint8Array): number { let t = 0; const read = () => t; for (let i = 0; i < view.length; i++) t += view[i]; return read(); }
const view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;
console.log(run(view));
console.log(run(view.subarray(0, 8)));
