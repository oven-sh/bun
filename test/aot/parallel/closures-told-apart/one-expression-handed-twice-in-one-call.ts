function both(a: () => number, b: () => number): string { return (a === b) + ":" + (a() + b()); }
function handOver(k: number): string {
  const f = () => k;
  return both(f, f) + " " + both(() => k, () => k);
}
console.log(handOver(1), handOver(2));
