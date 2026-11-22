const A = "outer";
function one() { return 1; }
enum E { A = one(), B = eval("typeof A === 'string' ? 2 : 3") }
console.log(E.A, E.B);
