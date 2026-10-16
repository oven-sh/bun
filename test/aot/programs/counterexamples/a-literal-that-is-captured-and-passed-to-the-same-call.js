// An object that the callee captures is also the argument of the call.
function outer() { const t = {}; function f(o) { return typeof t; } return f(t); }
console.log(outer());
