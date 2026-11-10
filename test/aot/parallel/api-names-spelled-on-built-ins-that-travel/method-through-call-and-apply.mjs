function use(b) {
  return b.escapeHTML.call(b, "<a>") + b.escapeHTML.apply(b, ["<b>"]);
}
console.log(use(Bun));
