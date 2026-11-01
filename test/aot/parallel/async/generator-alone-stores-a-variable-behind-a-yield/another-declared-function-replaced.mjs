// Nothing but a generator stores this variable, behind a yield, and every step is made by code that knows no generator: the read behind the steps finds the new value.
function* f(n) { yield "a"; h = g; f = g; yield "c"; }
function g(n) { return ["b" + n]; }
function h(n) { return ["h" + n]; }
const x = h(1).join(); const s = [...f(1)].join(); const y = h(1).join(); console.log(x, s, y);
