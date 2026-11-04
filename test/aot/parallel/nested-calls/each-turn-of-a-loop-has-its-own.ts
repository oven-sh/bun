function outer(n: number) {
  const later: Array<() => number> = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 10;
    const f = (x: number) => x + k + i;
    sum += f(1);
    later.push(() => f(100));
  }
  return sum + ":" + later.map(g => g()).join(",");
}
console.log(outer(3));
