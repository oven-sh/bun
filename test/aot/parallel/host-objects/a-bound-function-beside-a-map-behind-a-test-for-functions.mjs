function measure(thing, value) {
  if (typeof thing === "function") return thing(value);
  return thing.size;
}
console.log(measure(new Map([[1, 2]]), 0), measure(Math.sqrt.bind(null), 81));
