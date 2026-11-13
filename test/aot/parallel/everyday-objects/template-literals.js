// Template literals with expressions, nested ones and a tag
function list(strings, ...values) {
  return strings.raw.map((part, i) => part + (i < values.length ? `[${Array.isArray(values[i]) ? values[i].join("&") : values[i]}]` : "")).join("");
}
function text(name, items) {
  const plain = `${name} has ${items.length ? `${items.length} item${items.length > 1 ? "s" : ""}` : "nothing"}`;
  return plain + " " + list`of ${name}\n: ${items} ${items.map(item => `<${item}>`).join("")}`;
}
console.log(text("Ann", ["a", "b"]));
console.log(text("Bob", ["c"]));
console.log(text("", []));
