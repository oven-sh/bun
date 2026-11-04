// A callee writes a field on its way to a throw, and the caller, which catches, looks at the field before the call, in the handler and behind it.
function make() { return { v: 0, bad: 0 }; }
function middle(o, v) { if (v < 0) { o.bad = v; throw new RangeError("below zero"); } o.v = v; }
function outer(o, v) { const before = o.bad; let caught = "none"; try { middle(o, v); } catch (e) { caught = e.name + o.bad; } const behind = o.bad; return before + ">" + caught + ">" + behind + ":" + o.v; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(o, i - 2); } catch { s += "!"; } s += o.bad + "/" + o.v + ","; } return s; }
console.log(outer(make(), -1), outer(make(), 4), looped(make()));
