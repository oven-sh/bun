var q = "file";
enum E { A = (eval("var q = 'enum'"), 1) }
console.log(q, E.A);
