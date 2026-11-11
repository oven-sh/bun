async function get() {
  return Bun;
}
console.log((await get()).escapeHTML("<a>"));
