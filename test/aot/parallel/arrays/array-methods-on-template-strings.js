// Array methods are called on the list of strings that a tag function is handed.
const tag = (strings, ...rest) => strings;
const copy = tag`a${1}b`.concat();
console.log(typeof copy[0], copy[0], copy.length);
console.log(tag`a${1}b`.map(part => part + part).join());
function build(strings, ...values) {
  let text = "";
  strings.forEach((part, index) => {
    text += part.toUpperCase() + (values[index] ?? "");
  });
  return text;
}
console.log(build`ab${1}cd${2}ef`);
