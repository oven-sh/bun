class Row {
  port = 80;
}
function peek(base) {
  const target = base ?? new Row();
  Object.defineProperty(target, "value", {
    get() {
      Object.freeze(this);
      return 1;
    },
  });
  target.value;
  try {
    target.port = 81;
  } catch {}
  return target.port;
}
console.log(peek(), peek(Object.defineProperties({}, JSON.parse("{}"))));
