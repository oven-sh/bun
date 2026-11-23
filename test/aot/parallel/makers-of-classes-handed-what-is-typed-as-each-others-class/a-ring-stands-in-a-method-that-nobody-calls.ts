class Kept { used() { return 1; } never() { function M(B: new () => object) { return class X extends B {}; } function N(B: new () => object) { return class Y extends B {}; } let y = Object as unknown as ReturnType<typeof N>; const x = M(y); y = N(x); return [x, y]; } }
console.log(new Kept().used()); export {};
