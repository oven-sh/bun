const above = { inherited() { return "from above"; }, shared: "shared" };
function make(i) { return { __proto__: above, a: i, b: i + 1 }; }
function copy(s) { return { ...s }; }
let out = "";
for (let i = 0; i < 3; i++) {
  const source = make(i);
  const made = copy(source);
  out += typeof made.inherited + " " + made.shared + " " + ("inherited" in made) + " " + source.inherited() + " " + made.a + made.b + "; ";
}
console.log(out);
