// The first name of a `--define` value is looked for where the defined name is written, also where it names a built-in: a variable that a direct eval declares there hides the built-in.
// Flags: --define FLOOR=Math.floor --define KIND=Symbol
function call(text) {
  eval(text);
  return [FLOOR(2.5), typeof KIND].join(", ");
}
console.log(call(""), "|", call("var Math = { floor: () => 'declared by the text' }, Symbol = 1"));
