// A callee stores behind a test that, in the text of the program, no value passes: the one object that does comes out of JSON.parse, and the caller looks at the field before and behind.
function middle(o) { if (typeof o === "object" && o !== null) o.seen = (o.seen | 0) + 1; }
function outer(o) { const before = o.seen; middle(o); const behind = o.seen; return before + ">" + behind; }
function looped(o) { let s = ""; for (let i = 0; i < 3; i++) { middle(o); s += o.seen + ","; } return s; }
middle(1);
middle("text");
console.log(outer(JSON.parse('{"seen":4}')), looped(JSON.parse('{"seen":0}')));
