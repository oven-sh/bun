// Has instance enters code that has an effect (module variable), and a caller of the function that holds it looks at the state before and behind.
let count = 0;
class C { static [Symbol.hasInstance](v) { count++; return true; } }
function make() { return C; }
function middle(c, k) { return 1 instanceof c; }
function outer(c) { const before = count; middle(c, "x"); const behind = count; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += count + ","; } return s; }
console.log(outer(make()), looped(make()));
