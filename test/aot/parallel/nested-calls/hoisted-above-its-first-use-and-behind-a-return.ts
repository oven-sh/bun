function outer(x: number): number {
  if (x > 2) return late(x);
  const limit = x * 2;
  return late(limit) + readsLimit();
  function late(y: number): number { return y + 1; }
  function readsLimit(): number { return limit; }
}
function early(): string {
  try { return String(peek()); } catch (e) { return (e as Error).name; }
  function peek(): number { return later; }
  const later = 5;
}
console.log(outer(1), outer(5), early());
