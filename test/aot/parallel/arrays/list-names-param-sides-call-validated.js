// A list names a parameter on both sides of a call that stores an int32 to it in a validating build.
// Flags: --aot-validate
const f = (n) => { for (const e of [n, (() => n |= 0)(), n]) console.log(e); };
f(1.5);
const g = (n) => [n, (() => n ^= 1)(), n];
const r = g(3.75);
console.log(r[0] + r[1] + r[2]);
