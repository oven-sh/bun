const seen = { right: 0 };
const n = JSON.parse("1") | 0;
function a1(x) { return 1; }
function a2(x) { return 2; }
function a3(x) { return 3; }
function a4(x) { return 4; }
function a5(x) { return 5; }
function a6(x) { return 6; }
let a = a1;
if (n > 5) a = a2;
if (n > 6) a = a3;
if (n > 7) a = a4;
if (n > 8) a = a5;
if (n > 9) a = a6;
function b1(x, ...rest) { if (rest.length) seen.right = rest[rest.length - 1]; return 11; }
function b2(x, y) { return 12; }
function b3(x, y) { return 13; }
function b4(x, y) { return 14; }
function b5(x, y) { return 15; }
let b = b1;
if (n > 5) b = b2;
if (n > 6) b = b3;
if (n > 7) b = b4;
if (n > 8) b = b5;
function c1(x) { late(); return 21; }
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
let left, all;
function late() { left = a; if (n) left = b; all = left; if (n > 5) all = c; console.log(all(1, "text")); }
console.log(a(7), b(7), c(9));
console.log(typeof seen.right, String(seen.right));
