async function run(view: Uint8Array) { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; await null; for (let i = 0; i < view.length; i++) t += view[i] * 2; return t; }
const view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;
console.log(await run(view));
console.log(await run(view.subarray(0, 9)));
