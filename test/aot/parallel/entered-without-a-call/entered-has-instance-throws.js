// Has instance enters code that has an effect (throws), and a caller of the function that holds it looks at the state before and behind.
class C { static [Symbol.hasInstance](v) { throw new Error("thrown"); return true; } }
function make() { return C; }
function middle(c, k) { return 1 instanceof c; }
function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }
console.log(outer(make()), looped(make()));
