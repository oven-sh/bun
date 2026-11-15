const C = [0.5, 1.25, 2, 0.75], X = [0.5, 1, 1.5, 2, 2.5], OUT = [0.5, 0.5, 0.5, 0.5, 0.5];
function polynomial(c: number[], x: number[]): number { let s = 0; for (let k = 0; k < x.length; k++) s += c[0]! + x[k]! * (c[1]! + x[k]! * (c[2]! + x[k]! * c[3]!)); return s; }
function into(c: number[], x: number[], out: number[]): number { for (let k = 0; k < x.length; k++) out[k] = c[0]! * x[k]! + c[1]!; return out[4]!; }
function twice(c: number[], x: number[]): number { let s = 0; for (let k = 0; k < x.length; k++) s += c[2]! * x[k]! + c[2]!; return s; }
function asKeys(c: number[], x: number[]): string { let s = ""; for (let k = 0; k < x.length; k++) s += c[x[k]! | 0] + ","; return s; }
function told(x: number[]): string { let s = ""; for (let k = 0; k < x.length; k++) { const v = x[k]!; s += (v === v ? (Object.is(v, -0) ? "-0" : v > 1e9 ? "big" : v < 1 ? "small" : Number.isInteger(v) ? "whole" : "fraction") : "nan") + " "; } return s; }
const say: unknown[] = [polynomial(C, X), into(C, X, OUT), twice(C, X), asKeys(C, X), told(X), told(C), OUT.join()];
const odd = [NaN, -0, Infinity, -Infinity, 2 ** 40, 2 ** 31, -(2 ** 31) - 1, 1e300, 5e-324, 4294967295.5];
for (let i = 0; i < odd.length; i++) { X[i % X.length] = odd[i]!; C[i % C.length] = odd[odd.length - 1 - i]!; say.push(polynomial(C, X), into(C, X, OUT), twice(C, X), asKeys(C, X), told(X), told(C)); }
console.log(say.map(String).join("\n"));
export {};
