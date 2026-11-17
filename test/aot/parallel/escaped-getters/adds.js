class Row {
  port = 80;
}
function peek(base) {
  const target = base ?? new Row();
  Object.defineProperty(target, "value", {
    get() {
      this.seen = 1;
      return 1;
    },
  });
  target.value;
  return typeof target.seen;
}
console.log(peek(), peek(Object.defineProperties({}, JSON.parse("{}"))));
