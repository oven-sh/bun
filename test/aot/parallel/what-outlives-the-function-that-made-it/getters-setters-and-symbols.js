let kept;
const sink = { set take(o) { kept = o; }, get give() { return { v: 5 }; } };
function run(i) { const o = { v: i }; sink.take = o; const g = sink.give; return g; }
function coerce(i) { const o = { v: i, [Symbol.toPrimitive]() { kept = this; return i; } }; return +o; }
console.log(run(1).v, kept.v, coerce(2), kept.v);
