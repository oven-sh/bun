// A function writes a field and throws, the function between catches that and returns, and the outer caller, which has no handler, looks at the field before and behind.
function make() { return { v: 0, bad: 0 }; }
function inner(o, v) { if (v < 0) { o.bad = v; throw new RangeError("below zero"); } o.v = v; }
function middle(o, v) { try { inner(o, v); } catch { return false; } return true; }
function outer(o, v) { const before = o.bad; const ok = middle(o, v); const behind = o.bad; return before + ">" + behind + ":" + ok; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { middle(o, i - 2); s += o.bad + ","; } return s; }
console.log(outer(make(), -1), outer(make(), 4), looped(make()));
