// A function hands native code a callback that writes a field and throws, native code catches that and the function returns, and its caller looks at the field before and behind.
function make() { return { bad: 0 }; }
function middle(o) { const refused = new Promise(() => { o.bad = o.bad + 1; throw new RangeError("inside"); }); refused.catch(() => { }); }
function outer(o) { const before = o.bad; middle(o); const behind = o.bad; return before + ">" + behind; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { middle(o); s += o.bad + ","; } return s; }
console.log(outer(make()), looped(make()));
