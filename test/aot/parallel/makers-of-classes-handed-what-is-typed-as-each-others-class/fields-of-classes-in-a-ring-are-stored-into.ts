function M(B: new () => object) { return class X extends B { p = 0; }; }
function N(B: new () => object) { return class Y extends B { q = 0; }; }
let y = Object as unknown as ReturnType<typeof N>; const x = M(y); y = N(x);
const o = new x(); o.p = 5; const w = new y(); w.q = 7; console.log(o.p, w.q); export {};
