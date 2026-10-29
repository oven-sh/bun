// A copy by spread of a record whose prototype was changed.
const above = { inherited() { return "from above"; } };
function make(i) { const o = { a: i, b: i + 1 }; Object.setPrototypeOf(o, above); return o; }
function copy(s) { return { ...s }; }
let out = "";
for (let i = 0; i < 3; i++) {
  const made = copy(make(i));
  let called;
  try { called = made.inherited(); } catch (e) { called = e.constructor.name; }
  out += called + " " + made.a + "; ";
}
console.log(out);
