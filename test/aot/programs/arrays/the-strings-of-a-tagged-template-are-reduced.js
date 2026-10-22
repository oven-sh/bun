function dedent(strings, ...values) {
  return strings.reduce((text, part, index) => text + part + (index < values.length ? values[index] : ""), "");
}
console.log(dedent`one ${1} two ${2} three`);
