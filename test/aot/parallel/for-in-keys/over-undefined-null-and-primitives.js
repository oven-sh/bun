// A for-in over undefined and null has no turn and throws nothing. Over a text it lists the indexes, over a number nothing.
function count(o) {
  let n = 0, last = "none";
  for (const k in o) { n++; last = k; }
  return n + ":" + last;
}
function overUndefined() { let n = 0; for (const k in undefined) n++; return n; }
function overNull() { let n = 0; for (const k in null) n++; return n; }
function deed() { return [count(undefined), count(null), count("ab"), count(7), count(true), count(Symbol.iterator)].join(" "); }
console.log(deed(), overUndefined(), overNull());
for (let i = 0; i < 3; i++) console.log(count({ a: i }), deed(), overUndefined(), overNull());
