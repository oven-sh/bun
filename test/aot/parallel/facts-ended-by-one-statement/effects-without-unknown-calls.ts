class Counter {
  hits = 0;
  misses = 0;
  limit = 5;
  log: number[] = [0, 0, 0];
}
let seen = 0;
function probe(c: Counter, key: number, depth: number): number {
  if (depth > 0) return probe(c, key, depth - 1) | 0;
  let h = key;
  for (let i = 0; i < 6; i++) h = (Math.imul(h, 31) + i) | 0;
  if ((h & 3) === 0) {
    c.hits++;
    c.log[1] = h & 7;
    seen++;
  } else {
    c.misses++;
    c.limit = 5 + (h & 1);
  }
  return h;
}
function drive(c: Counter, n: number): string {
  let text = "",
    sum = 0;
  for (let i = 0; i < n; i++) {
    const hits = c.hits,
      limit = c.limit,
      first = c.log[1],
      before = seen;
    const h = probe(c, i * 2654435761, 1);
    sum = (sum + h) | 0;
    text += c.hits - hits + "" + (c.limit - limit) + (c.log[1] - first) + (seen - before) + " ";
  }
  return text + sum + "/" + c.hits + "/" + c.misses;
}
console.log(drive(new Counter(), 12));
