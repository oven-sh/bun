try {
  throw Bun;
} catch (b) {
  console.log(b.escapeHTML("<a>"));
}
