function M(B: new () => object) { return class X extends B {}; }
function N(B: new () => object) { return class Y extends B { b() { return 2; } }; }
let y = Object as unknown as ReturnType<typeof N>; const x = M(y); y = N(x);
(x as any).extra = 1; (x as any).extra = 2; console.log((x as any).extra); export {};
console.log(new y().b(), new y() instanceof x, new x() instanceof y, Object.getPrototypeOf(x) === Object, Object.getPrototypeOf(y) === x);
