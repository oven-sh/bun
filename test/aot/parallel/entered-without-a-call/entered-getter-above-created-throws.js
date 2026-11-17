// Getter above created enters code that has an effect (throws), and a caller of the function that holds it looks at the state before and behind.
function make() { return Object.create({ get x() { throw new Error("thrown"); return 1; } }); }
function middle(c, k) { return c.x; }
function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }
console.log(outer(make()), looped(make()));
