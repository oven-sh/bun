// `if (o === undefined) o = {..}; else ..`: the else arm does not run when undefined was passed.
function f(o) { let s = "default"; if (o === undefined) o = { a: 1 }; else s = "given"; return s + o.a; }
console.log(f({ a: 2 }), f(undefined));
