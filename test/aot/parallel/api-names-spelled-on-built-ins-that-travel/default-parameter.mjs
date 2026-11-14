function use(b = Bun) {
  return b.escapeHTML("<a>");
}
console.log(use());
