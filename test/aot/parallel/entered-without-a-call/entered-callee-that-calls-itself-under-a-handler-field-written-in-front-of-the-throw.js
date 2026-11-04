// A function calls itself under a handler, the inner run writes a field and throws, the outer run catches and returns, and the caller looks at the field before and behind.
function make() { return { bad: 0 }; }
function middle(o, depth) { if (!depth) { o.bad = o.bad + 1; throw new RangeError("bottom"); } try { middle(o, depth - 1); } catch { return depth; } return -1; }
function outer(o) { const before = o.bad; const at = middle(o, 2); const behind = o.bad; return before + ">" + behind + ":" + at; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { middle(o, 1); s += o.bad + ","; } return s; }
console.log(outer(make()), looped(make()));
