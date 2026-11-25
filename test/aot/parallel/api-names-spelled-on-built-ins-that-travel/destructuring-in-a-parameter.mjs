function use({ escapeHTML }) {
  return escapeHTML("<a>");
}
console.log(use(Bun));
