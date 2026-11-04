// A small function with a for-in is called twice in one function, on two objects, one call in the loop of the other.
function names(o) { let text = ""; for (const k in o) text += k + ":" + o[k] + ","; return text; }
function both(p, q) {
  let text = names(p) + "|" + names(q) + "|";
  for (const k in p) text += k + "(" + names(q) + ")";
  return text;
}
function deed() { return both({ a: 1, b: 2 }, { x: 8, y: 9, z: 10 }); }
console.log(deed());
for (let i = 0; i < 3; i++) console.log(both({ a: i }, {}), "#", deed());
