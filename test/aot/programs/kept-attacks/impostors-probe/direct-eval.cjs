// Impostors probe: direct eval. It prints what plain Bun prints.
function pick(text) {
  var local = 1;
  eval(text);
  return local + 1;
}
console.log(pick("local = 41"), pick("var other = 2"));
