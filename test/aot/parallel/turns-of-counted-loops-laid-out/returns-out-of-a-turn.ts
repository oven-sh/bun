function run(view: Uint8Array, wanted: number): number { for (let i = 0; i < view.length; i++) { if (view[i] === wanted) return i; } return -1; }
const view = new Uint8Array(40); for (let i = 0; i < 40; i++) view[i] = i * 3;
console.log(run(view, 0));
console.log(run(view, 3));
console.log(run(view, 21));
console.log(run(view, 24));
console.log(run(view, 27));
console.log(run(view, 60));
console.log(run(view, 117));
console.log(run(view, 118));
