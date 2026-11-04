// Iterator in a spread enters code that has an effect (module variable), and a caller of the function that holds it looks at the state before and behind.
let count = 0;
class C { [Symbol.iterator]() { count++; return [1].values(); } }
function make() { return new C(); }
function middle(c, k) { return [...c].length; }
function outer(c) { const before = count; middle(c, "x"); const behind = count; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += count + ","; } return s; }
console.log(outer(make()), looped(make()));
