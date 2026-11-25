var q = "file";
enum E { A = (eval("var q = 'first'"), 1) }
enum E { B = q === "file" ? 2 : 3 }
console.log(q, E.A, E.B);
