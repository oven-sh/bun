// What else a call is stored into as a value.
let last, count = 0;
const next = () => count++ < 2 ? "word" : count < 4 ? undefined : { count };
function take(kept) { arguments[0] = 0; return [(kept = next()), kept, arguments[0]]; }
console.log(JSON.stringify(take(1)), JSON.stringify(take(2)), JSON.stringify([(last = next()), last, last = next()]));
function* steps() { let held; while (true) yield held = next(), yield held; }
const walk = steps(); console.log(JSON.stringify([walk.next().value, walk.next().value, walk.next().value]));
// A name that a store does not change, a setter without a getter, a name that an eval adds.
const named = function own() { return typeof (own = next()) + typeof own; };
console.log(named());
let outer = 1;
console.log((function () { with ({ set outer(v) { } }) { return typeof (outer = next()); } })(), outer);
