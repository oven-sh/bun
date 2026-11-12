const log = [];
function note(x) { log.push(x); return x; }
function list(...xs) { return xs.join(); }
function pass(...xs) { return list(note("in"), ...xs, note("behind")); }
for (let i = 0; i < 2; i++) console.log(pass(note(i), note("b"), note("c")));
console.log(log.join());
