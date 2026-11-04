function* run(view: Uint8Array) { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; yield t; for (let i = 0; i < view.length; i++) t += view[i] * 2; yield t; }
const view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;
console.log([...run(view)].join());
console.log([...run(view.subarray(0, 9))].join());
