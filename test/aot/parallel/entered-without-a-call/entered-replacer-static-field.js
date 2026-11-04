// Replacer enters code that has an effect (static field), and a caller of the function that holds it looks at the state before and behind.
class Counter { static n = 0; }
function make() { return "a"; }
function middle(c, k) { return c.replace("a", () => { Counter.n++; return "b"; }); }
function outer(c) { const before = Counter.n; middle(c, "x"); const behind = Counter.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += Counter.n + ","; } return s; }
console.log(outer(make()), looped(make()));
