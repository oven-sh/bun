// A rest is passed on by a spread: one argument is a string, one a Buffer, and the function goes over the Buffer by position.
function sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function forward(...rest) { return sum(...rest); }
console.log(forward("t", Buffer.from([1, 2, 3])));
