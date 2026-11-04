// Species enters code that has an effect (throws), and a caller of the function that holds it looks at the state before and behind.
class C extends Array { static get [Symbol.species]() { throw new Error("thrown"); return Array; } }
function make() { return new C(); }
function middle(c, k) { return c.map(v => v).length; }
function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }
console.log(outer(make()), looped(make()));
