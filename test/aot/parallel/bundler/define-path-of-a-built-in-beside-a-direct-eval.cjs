// A `--define` value that is a built-in or a path below one is that built-in where nothing can declare its first name. Beside a direct `eval` the first name is looked for where the defined name is written: it finds the same built-in where the evaluated text declares nothing, and a variable that the text declares hides the built-in.
// Flags: --define FLOOR=Math.floor --define KIND=Symbol
function alone() {
  return [FLOOR(2.5), typeof KIND].join(", ");
}
function call(text) {
  eval(text);
  return [FLOOR(2.5), typeof KIND].join(", ");
}
console.log(alone(), "|", call(""), "|", call("var Math = { floor: () => 'declared by the text' }, Symbol = 1"));
