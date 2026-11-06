// The labels spell the names of loaders and of an evaluator of the global object, as any tokenizer's do. A label makes no text.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: blocked by eval: the program calls eval() or new Function() (eval)
// Build prints: 0 x aot: trim: blocked by dynamic-import: the program calls import() or require() with a dynamic path
function kindOf(word) {
  switch (word) {
    case "require":
    case "import":
    case "eval":
    case "register":
      return "keyword";
    default:
      return "name";
  }
}
const pick = (holder, key) => holder[key];
let held;
[0].forEach(function () {
  held = this;
});
console.log(kindOf(process.env.WORD ?? "other"), typeof pick(held, process.env.KEY ?? "nothing"));
