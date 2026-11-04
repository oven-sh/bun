function run(view: Uint8Array): number { let t = 0; for (let i = 0; i < 9; i++) t += view[i]; return t; }
const view = new Uint8Array(64); for (let i = 0; i < 64; i++) view[i] = i * 5 + 1;
console.log(run(view));
