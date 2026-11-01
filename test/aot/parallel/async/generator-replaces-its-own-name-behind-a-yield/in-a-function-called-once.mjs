// A generator function stores another function to its own name behind a yield: the next call by that name reaches the other one.
function* f(n) { yield "a"; if (!(n > 0)) return; f = g; yield* f(n - 1); }
function g(n) { return ["b" + n]; }
function main() { console.log([...f(1)].join()); console.log([...f(1)].join()); }
main();
