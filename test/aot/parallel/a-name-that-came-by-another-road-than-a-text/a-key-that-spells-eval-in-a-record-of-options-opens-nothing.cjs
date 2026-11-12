// `eval` is the name of an option here. Nobody lists the keys of the record: no text "eval" comes of it, though the global object is read under a key nobody knows.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: blocked by eval: the program calls eval() or new Function() (eval)
const options = { eval: true, name: "made" };
const pick = (holder, key) => holder[key];
let held;
[0].forEach(function () {
  held = this;
});
console.log(typeof pick(held, process.env.KEY ?? "nothing"), options.name);
