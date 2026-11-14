function run(view: Uint8Array, rounds: number): number { let t = 0; for (let r = 0; r < rounds; r++) { for (let i = 0; i < view.length; i++) t += view[i]; } return t; }
const view = new Uint8Array(100003); for (let i = 0; i < view.length; i++) view[i] = i;
console.log(run(view, 30));
