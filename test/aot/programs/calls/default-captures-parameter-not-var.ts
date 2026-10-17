// A parameter default that closes over a parameter sees the parameter, not a `var` of the same name in the body.
function hasOwnScope(a: number, b = () => a) { var a = 2; return b() + a; }
console.log(hasOwnScope(1), "(3: the default closes over the parameter, not over the var of the body)");
function writes(a: number, b = () => a, c = (v: number) => { a = v; }) { var a = 10; c(5); return [a, b()].join(); }
console.log(writes(1), "(10,5)");
function noVar(a: number, b = () => a) { a = 2; return b() + a; }
console.log(noVar(1), "(4: without a var of that name there is one variable)");
