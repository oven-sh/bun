// Has instance enters code that has an effect (closure of each entry), and a caller of the function that holds it looks at the state before and behind.
const made = [];
class C { static [Symbol.hasInstance](v) { { let n = 0; made.push(() => ++n); } return true; } }
function make() { return C; }
function middle(c, k) { return 1 instanceof c; }
function outer(c) { const before = made.map(f => f()).join(""); middle(c, "x"); const behind = made.map(f => f()).join(""); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += made.map(f => f()).join("") + ","; } return s; }
console.log(outer(make()), looped(make()));
