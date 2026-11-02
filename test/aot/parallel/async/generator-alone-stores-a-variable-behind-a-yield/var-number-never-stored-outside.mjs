// Nothing but a generator stores this variable, behind a yield, and every step is made by code that knows no generator: the read behind the steps finds the new value.
var count;
function* f(n) { yield "a"; count = n; f = g; yield "c"; }
function g(n) { return ["b" + n]; }
function u(n) { const a = count; const x = [...f(n)].join(); return [a, x, count].join(); }
console.log(u(5));
