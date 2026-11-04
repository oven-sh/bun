// Iterator taken apart enters code that has an effect (throws), and a caller of the function that holds it looks at the state before and behind.
class C { [Symbol.iterator]() { throw new Error("thrown"); return [1].values(); } }
function make() { return new C(); }
function middle(c, k) { const [v] = c; return v; }
function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }
console.log(outer(make()), looped(make()));
