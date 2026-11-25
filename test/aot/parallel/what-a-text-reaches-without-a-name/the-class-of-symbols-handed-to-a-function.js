// The class of symbols is handed on, and `for` is read off a value that nobody knows.
function made(kind) {
  return kind.for("nodejs.util.inspect.custom");
}
const key = made(Symbol);
const shown = {
  [key](depth, options, inspect) {
    return "printed with " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 });
  },
};
console.log(shown);
