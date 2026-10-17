// A function declaration that has the name of a parameter sees the `let` of the body as it is when called.
function o(p) { let k = "late"; function p() { return k; } return p(); }
console.log(o(0));
