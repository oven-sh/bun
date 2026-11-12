function M(B: new () => object) { return class X extends B { p = 0; }; }
function N(B: new () => object) { return class Y extends B { q = 0; }; }
let y = Object as unknown as ReturnType<typeof N>; const x = M(y); y = N(x);
try { Buffer.from(new x() as any); } catch (e) { console.log((e as Error).name); } export {};
