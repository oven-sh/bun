// A function writes a field and throws, the async function between never suspends and hands back a rejected promise, and the outer caller, which has no handler, looks at the field before and behind.
function make() { return { v: 0, bad: 0 }; }
function inner(o, v) { if (v < 0) { o.bad = v; throw new RangeError("below zero"); } o.v = v; }
async function middle(o, v) { inner(o, v); }
function outer(o, v) { const before = o.bad; middle(o, v).catch(() => { }); const behind = o.bad; return before + ">" + behind; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { middle(o, i - 2).catch(() => { }); s += o.bad + ","; } return s; }
console.log(outer(make(), -1), outer(make(), 4), looped(make()));
