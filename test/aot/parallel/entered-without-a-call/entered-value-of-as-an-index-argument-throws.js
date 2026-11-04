// Value of as an index argument enters code that has an effect (throws), and a caller of the function that holds it looks at the state before and behind.
class C { valueOf() { throw new Error("thrown"); return 1; } }
function make() { return new C(); }
function middle(c, k) { return "abc".charAt(c); }
function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }
console.log(outer(make()), looped(make()));
