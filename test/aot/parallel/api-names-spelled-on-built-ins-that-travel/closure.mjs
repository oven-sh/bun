function outer() {
  const b = Bun;
  return () => b.escapeHTML("<a>");
}
console.log(outer()());
