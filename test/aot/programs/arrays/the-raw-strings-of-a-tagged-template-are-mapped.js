function raw(strings, ...values) {
  return strings.raw.map((part, index) => part + (values[index] ?? "")).join("");
}
console.log(raw`x\n${1}y`);
