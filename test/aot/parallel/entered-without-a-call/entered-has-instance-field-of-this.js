// Has instance enters code that has an effect (field of this), and a caller of the function that holds it looks at the state before and behind.
class C { static [Symbol.hasInstance](v) { this.n = (this.n || 0) + 1; return true; } }
function make() { return C; }
function middle(c, k) { return 1 instanceof c; }
function outer(c) { const before = c.n; middle(c, "x"); const behind = c.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += c.n + ","; } return s; }
console.log(outer(make()), looped(make()));
