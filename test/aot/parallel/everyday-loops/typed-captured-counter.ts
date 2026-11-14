// A counter captured by a closure that two loops and the caller raise
function counter(start: number): { next: (by?: number) => number; all: number[] } {
  let value = start;
  const all: number[] = [];
  const next = (by = 1): number => {
    value += by;
    all.push(value);
    return value;
  };
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 2; k++) next(i * k + 0.5);
    all.push(next(i) * 10);
  }
  return { next, all };
}
for (const start of [0, 2147483646, -0.25]) {
  const { next, all } = counter(start);
  console.log(next(), next(-3), all.join());
}
