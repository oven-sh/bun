// Comparator enters code that has an effect (module variable), and a caller of the function that holds it looks at the state before and behind.
let count = 0;
function make() { return [2, 1]; }
function middle(c, k) { return c.sort((p, q) => { count++; return p - q; })[0]; }
function outer(c) { const before = count; middle(c, "x"); const behind = count; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += count + ","; } return s; }
console.log(outer(make()), looped(make()));
