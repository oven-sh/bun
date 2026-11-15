var q = 1;
enum E { A = (eval("var q = 40"), 1), B = q + 2, C = (() => q + 3)() }
console.log(q, E.A, E.B, E.C);
