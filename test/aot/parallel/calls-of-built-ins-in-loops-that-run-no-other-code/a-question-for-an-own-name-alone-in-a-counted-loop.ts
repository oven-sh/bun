function count(n: number): number {
  const box: { a: number; b?: number } = { a: 1 };
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (Object.hasOwn(box, "a")) hits++;
  }
  return hits;
}
console.log(count(10), count(3));
