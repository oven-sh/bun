function get() {
  return Bun;
}
console.log(get().escapeHTML("<a>"));
