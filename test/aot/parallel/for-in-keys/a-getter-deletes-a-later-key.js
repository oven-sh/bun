// The read under the first key runs a getter that deletes a later key: the loop must pass that key by.
function make() {
  const o = { get a() { delete this.c; return 1; }, b: 2, c: 3, d: 4 };
  return o;
}
function walk(o) {
  let text = "";
  for (const k in o) text += k + "=" + o[k] + " ";
  return text;
}
function deed() { return walk(make()); }
console.log(deed());
for (let i = 0; i < 4; i++) console.log(walk({ a: i, b: 2, c: 3, d: 4 }), "|", deed());
console.log(deed());
