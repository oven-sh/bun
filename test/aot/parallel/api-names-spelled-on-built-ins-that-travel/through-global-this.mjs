function use(g) {
  return g.Bun.escapeHTML("<a>");
}
console.log(use(globalThis));
