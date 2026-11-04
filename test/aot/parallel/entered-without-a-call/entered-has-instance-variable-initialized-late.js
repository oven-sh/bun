// Has instance enters code that has an effect (variable initialized late), and a caller of the function that holds it looks at the state before and behind.
let late;
function init() { late = { v: 1 }; }
class C { static [Symbol.hasInstance](v) { if (!late) init(); late.v++; return true; } }
function make() { return C; }
function middle(c, k) { return 1 instanceof c; }
function outer(c) { const before = (late ? late.v : "none"); middle(c, "x"); const behind = (late ? late.v : "none"); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += (late ? late.v : "none") + ","; } return s; }
console.log(outer(make()), looped(make()));
