function* give() {
  yield Bun;
}
for (const b of give()) console.log(b.escapeHTML("<a>"));
