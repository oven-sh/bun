function outer(n: number) {
  const out: Array<() => number> = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const twice = i * 2;
    sum += get();
    out.push(() => get() + 1);
    function get(): number { return twice + i; }
  }
  return sum + ":" + out.map(f => f()).join(",");
}
console.log(outer(4));
