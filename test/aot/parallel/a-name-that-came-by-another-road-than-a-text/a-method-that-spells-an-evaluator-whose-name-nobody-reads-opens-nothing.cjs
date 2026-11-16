// `eval` is the name of a method here. A name is read, of another function: no text "eval" comes of it, though the global object is read under a key nobody knows.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: blocked by eval: the program calls eval() or new Function() (eval)
const reader = {
  eval(text) {
    return text.length;
  },
};
function made() {}
const pick = (holder, key) => holder[key];
let held;
[0].forEach(function () {
  held = this;
});
console.log(typeof pick(held, process.env.KEY ?? "nothing"), reader.eval("four"), made.name);
