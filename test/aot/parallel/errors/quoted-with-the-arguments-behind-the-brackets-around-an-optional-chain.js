// An error quotes the arguments behind a member of an optional chain in brackets: `new (o?.a).M(1)`, and `(o?.a)["m"](1)`, which Bun's transpiler prints `(o?.a).m(1)`.
// Todo: the three quotes come without their arguments: the engine takes `new (o?.a).M(1)` for no construction, and finds no call behind a key in quotes. oven-sh/WebKit has both since, the engine of this Bun has not. With this line goes the sentence on `new` under "Error messages" in docs/compiler/compatibility.mdx
const o = { a: {} };
function tell(label, run) {
  try {
    run(o);
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
tell("member constructed with an argument", o => new (o?.a).M1(1));
tell("name, member constructed with an argument", o => {
  const r = o?.a;
  return new r.M2(1);
});
tell("member under a key in quotes called with an argument", o => (o?.a)["m3"](1));
