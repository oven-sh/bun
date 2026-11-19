// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// The bounds of the loop cross 2 ** 31 and are typed `number`. Number types did not help here: the build stopped.
function veil(value: any): any { return JSON.parse("0", () => value); }
function y10(a: any, t: number, d: any, e: any): any { let i = d; while (a[i] !== t && i < e) { i++; } return i; }
function k12(a: any, d: number, e: number): string { let c = 0; let i = d; while (i < e) { switch (a[i]) { case 0: c++; } i += 1; } return c + "/" + (i - 2 ** 31); }
console.log(typeof y10(JSON.parse("[32,0,10]"), 2.5, "0", 42));
console.log(k12(veil([49, 0, 42]), 2 ** 31 - 8, 2 ** 31 + 4));
