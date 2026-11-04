function q() { return "file"; }
enum E { A = (eval("function q() { return 'enum'; }"), 1), B = q().length }
console.log(q(), E.A, E.B);
