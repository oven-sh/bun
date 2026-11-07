function fold(o, depth) { let s = 0; for (let i = 0; i < o.n; i++) { s += o.v; if (i === 1 && depth) { o.v++; s += fold(o, depth - 1); } } return s; }
let t = 0; for (let k = 0; k < 200; k++) t += fold({ n: 4, v: 1 }, 2); console.log(t);
