// A round through the language: small closed. It prints what plain Bun prints.
function same(n: number): number { return n; }
function plus(n: number): number { return n + 1; }
function times(n: number, m: number): number { return n * m; }
function viaCall(n: number): number { return same(n); }
function text(s: string): string { return s; }
function typedUser(n: number): number { return (same(n) + plus(n) + viaCall(n) + times(n, 2)) * 2; }
const r1 = (same as any)("s");
console.log(typeof r1);
const r2 = (plus as any)("s");
console.log(typeof r2);
const r3 = (times as any)(3n, 4n);
console.log(typeof r3);
const r4 = (viaCall as any)("c");
console.log(typeof r4);
const r5 = (text as any)(42);
console.log(typeof r5);
console.log(typedUser(1));
const r6 = (typedUser as any)("1");
console.log(typeof r6);
console.log(r1 + "|" + r2 + "|" + r4 + "|" + (r5 + 1) + "|" + r6);
