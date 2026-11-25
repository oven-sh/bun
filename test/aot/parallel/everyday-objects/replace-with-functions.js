// replace with functions, patterns of $ and a counter that is captured
function change(text) {
  let n = 0;
  const numbered = text.replace(/(\w)(\w*)/g, (all, first, rest, at) => first.toUpperCase() + rest + ++n + (at % 2 ? "" : "."));
  const swapped = text.replace(/(\w+) (\w+)/, "$2 $1 [$&|$`|$']");
  return numbered + " / " + swapped + " / " + text.replaceAll("o", "0") + " " + n;
}
console.log(change("one two three"));
console.log(change("foo"));
console.log(change("a b"));
