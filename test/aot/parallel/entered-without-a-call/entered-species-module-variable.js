// Species enters code that has an effect (module variable), and a caller of the function that holds it looks at the state before and behind.
let count = 0;
class C extends Array { static get [Symbol.species]() { count++; return Array; } }
function make() { return new C(); }
function middle(c, k) { return c.map(v => v).length; }
function outer(c) { const before = count; middle(c, "x"); const behind = count; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += count + ","; } return s; }
console.log(outer(make()), looped(make()));
