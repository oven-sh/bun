const seen = { text: 0 };
const n = JSON.parse("1") | 0;
function one(x) { return 1; }
function two(x) { later(); return 2; }
function three(x) { return 3; }
function four(x) { return 4; }
function five(x) { return 5; }
function first(x) { return "a"; }
function second(x) { return "b"; }
function third(x) { return "c"; }
function fourth(x) { return "d"; }
function fifth(x) { return "e"; }
function sixth(x) { return "f"; }
function callFew(held) { const answer = held(7); if (typeof answer === "string") seen.text = answer; return answer; }
function callMany(held) { return held(8); }
let few = two; if (n > 5) few = one; if (n > 6) few = three; if (n > 7) few = four; if (n > 8) few = five;
let many = first; if (n > 5) many = second; if (n > 6) many = third; if (n > 7) many = fourth; if (n > 8) many = fifth; if (n > 9) many = sixth;
function later() { console.log(callFew(many)); }
console.log(callMany(many), callFew(few));
console.log(typeof seen.text, seen.text + "!");
