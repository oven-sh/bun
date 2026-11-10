function choices(items: number[]): number[][] {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) {
    const chosen: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (mask & (1 << i)) chosen.push(items[i]);
    }
    out.push(chosen);
  }
  return out;
}
console.log(
  choices([1, 2, 3])
    .map(one => one.join("+") || "-")
    .join(),
);
