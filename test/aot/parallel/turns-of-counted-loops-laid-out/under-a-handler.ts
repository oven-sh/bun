function run(view: Uint8Array): number { let t = 0; try { for (let i = 0; i < view.length; i++) t += view[i]; } catch (error) { t = -1; } return t; }
const view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;
console.log(run(view));
console.log(run(view.subarray(0, 8)));
console.log(run(view.subarray(3, 10)));
