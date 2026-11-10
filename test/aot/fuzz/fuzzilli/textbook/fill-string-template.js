function filled(text, values) {
  return text.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? values[key] : whole));
}
console.log(filled("{greeting}, {name}! {missing}", { greeting: "hello", name: "ann" }));
