// the variable holds no text when the loop is entered, and every turn joins a text to it: a number, -0, a boolean, undefined, null, a BigInt, an object that converts
let log = "";
function fromZero(n: number) { let x: any = 0; let i = 0; do x += "k"; while (++i < n); return x; }
function fromNegativeZero(n: number) { let x: any = -0; let i = 0; do x += "k"; while (++i < n); return x; }
function from(first: any, n: number) { let x = first; let i = 0; do x += "k" + i; while (++i < n); return x; }
function mayHaveNoTurn(first: any, n: number) { let x = first; for (let i = 0; i < n; i++) x += "k"; return x; }
function looksFirst(first: any, n: number) { let x = first; let kinds = ""; let i = 0; do { kinds += typeof x + ","; x += "k"; } while (++i < n); return kinds + x; }
const converts = { toString() { log += "s"; return "S"; }, valueOf() { log += "v"; return 3; } };
console.log(fromZero(1), fromZero(3), typeof fromZero(1), fromNegativeZero(1), fromNegativeZero(2));
console.log(from(1.5, 2), from(true, 2), from(undefined, 2), from(null, 2), from(10n, 2), from("text", 2), from(NaN, 1), from(-0, 1));
console.log(from(converts, 2), log);
console.log(mayHaveNoTurn(0, 0), typeof mayHaveNoTurn(0, 0), Object.is(mayHaveNoTurn(-0, 0), -0), mayHaveNoTurn(0, 2), mayHaveNoTurn(converts, 0) === converts);
console.log(looksFirst(0, 3), looksFirst(null, 2), looksFirst("t", 2));
