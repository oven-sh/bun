// A generator function stores another function to its own name behind a yield: the next call by that name reaches the other one.
function* f(n) { yield "a"; f = g; yield "c"; }
function* g(n) { yield "b" + n; }
console.log([...f(1)].join()); console.log([...f(1)].join());

