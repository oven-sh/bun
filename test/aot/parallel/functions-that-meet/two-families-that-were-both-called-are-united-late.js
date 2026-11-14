const seen = { left: 0, right: 0 };
const n = JSON.parse("1") | 0;
function l1(x) { later(); return 1; }
function l2(x) { return 2; }
function l3(x) { return 3; }
function l4(x) { return 4; }
function l5(x) { return 5; }
let l = l1;
if (n > 5) l = l2;
if (n > 6) l = l3;
if (n > 7) l = l4;
if (n > 8) l = l5;
function r1(x) { seen.right = x; return 11; }
function r2(x) { return 12; }
function r3(x) { return 13; }
function r4(x) { return 14; }
function r5(x) { return 15; }
function r6(x) { return 16; }
let r = r1;
if (n > 5) r = r2;
if (n > 6) r = r3;
if (n > 7) r = r4;
if (n > 8) r = r5;
if (n > 9) r = r6;
function l0(x) { seen.left = x; return 0; }
if (n > 20) l = l0;
function later() { let both = l; if (n) both = r; console.log(both(true)); both = r; if (n) both = l0; if (n > 30) both = l; console.log(both(null)); }
console.log(r("text"), l(7));
console.log(typeof seen.left, String(seen.left), typeof seen.right, String(seen.right));
