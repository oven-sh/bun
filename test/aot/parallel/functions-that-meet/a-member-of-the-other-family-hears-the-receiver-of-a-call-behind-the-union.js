const seen = { left: 0, right: 0 };
const n = JSON.parse("1") | 0;
function l1() { later(); return 1; }
function l2() { return 2; }
function l3() { return 3; }
function l4() { return 4; }
function l5() { return 5; }
function r1() { seen.right = this.tag; return 11; }
function r2() { return 12; }
function r3() { return 13; }
function r4() { return 14; }
function r5() { return 15; }
function r6() { return 16; }
function l0() { seen.left = this.tag; return 0; }
const numbered = { numbers: 1, tag: 7, run: l1 };
if (n > 5) numbered.run = l2;
if (n > 6) numbered.run = l3;
if (n > 7) numbered.run = l4;
if (n > 8) numbered.run = l5;
if (n > 20) numbered.run = l0;
const lettered = { letters: 1, tag: 8, run: r1 };
if (n > 5) lettered.run = r2;
if (n > 6) lettered.run = r3;
if (n > 7) lettered.run = r4;
if (n > 8) lettered.run = r5;
if (n > 9) lettered.run = r6;
const texted = { texts: 1, tag: "text", run: undefined };
function choose(k) { return k ? l0 : r1; }
function later() { texted.run = choose(n - 1); console.log(texted.run()); texted.run = choose(n); console.log(texted.run()); }
console.log(lettered.run(), numbered.run());
console.log(typeof seen.left, seen.left + "!", typeof seen.right, seen.right + "!");
