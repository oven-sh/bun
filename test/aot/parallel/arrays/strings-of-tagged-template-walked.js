// The strings of a tagged template are walked by for each.
function build(strings, ...values) {
  let text = "";
  strings.forEach((part, index) => { text += part.toUpperCase() + (values[index] ?? ""); });
  return text;
}
console.log(build`ab${1}cd${2}ef`);
