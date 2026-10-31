// Nothing but a generator stores this variable, behind a yield, and every step is made by code that knows no generator: the read behind the steps finds the new value.
var count;
function* f(n) { yield "a"; count = n; f = g; yield "c"; }
function g(n) { return ["b" + n]; }
console.log(count, [...f(5)].join(), count);
