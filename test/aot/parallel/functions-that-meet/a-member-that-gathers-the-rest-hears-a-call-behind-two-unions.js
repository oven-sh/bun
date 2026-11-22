const seen = { last: 0 };
const n = JSON.parse("1") | 0;
function g1(x, ...rest) { if (rest.length) seen.last = rest[rest.length - 1]; return 1; }
function g2(x) { return 2; }
function g3(x) { return 3; }
function g4(x) { return 4; }
function g5(x) { return 5; }
let g = g1;
if (n > 5) g = g2;
if (n > 6) g = g3;
if (n > 7) g = g4;
if (n > 8) g = g5;
function a1(x) { return 11; }
function a2(x) { return 12; }
function a3(x) { return 13; }
function a4(x) { return 14; }
function a5(x) { return 15; }
function a6(x) { return 16; }
let a = a1;
if (n > 5) a = a2;
if (n > 6) a = a3;
if (n > 7) a = a4;
if (n > 8) a = a5;
if (n > 9) a = a6;
function c1(x) { first(); return 21; }
function c2(x) { return 22; }
function c3(x) { return 23; }
function c4(x) { return 24; }
function c5(x) { return 25; }
function c6(x) { return 26; }
function c7(x) { return 27; }
function c8(x) { return 28; }
function c9(x) { return 29; }
function c10(x) { return 30; }
function c11(x) { return 31; }
function c12(x) { return 32; }
let c = c1;
if (n > 5) c = c2;
if (n > 6) c = c3;
if (n > 7) c = c4;
if (n > 8) c = c5;
if (n > 9) c = c6;
if (n > 10) c = c7;
if (n > 11) c = c8;
if (n > 12) c = c9;
if (n > 13) c = c10;
if (n > 14) c = c11;
if (n > 15) c = c12;
function c0(x) { second(); return 20; }
if (n > 40) c = c0;
let all;
function first() { all = a; if (n) all = g; if (n > 5) all = c; console.log(all(1)); c0(0); }
function second() { console.log(all(1, 2, 3, "text")); }
console.log(g(7), a(7), c(9));
console.log(typeof seen.last, String(seen.last));
