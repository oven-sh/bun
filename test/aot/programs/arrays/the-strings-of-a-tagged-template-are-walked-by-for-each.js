function build(strings, ...values) {
  let text = "";
  strings.forEach((part, index) => { text += part.toUpperCase() + (values[index] ?? ""); });
  return text;
}
console.log(build`ab${1}cd${2}ef`);
