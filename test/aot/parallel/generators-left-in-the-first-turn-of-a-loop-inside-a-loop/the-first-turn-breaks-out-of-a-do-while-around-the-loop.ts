let deeds = 0;
function* two(k: number): Generator<number> {
  deeds++;
  if (k % 3 === 1) yield k;
  else if (k % 3 === 2) yield -k;
  deeds += 100;
}
type Box = { at: number; sum: number };
function walk(box: Box, n: number): number {
  outer: do {
    for (const x of two(box.at)) {
      box.sum = (box.sum + x) | 0;
      if (x < -3) break outer;
      continue outer;
    }
    box.sum = (box.sum - 1000) | 0;
  } while (++box.at < n);
  return box.sum;
}
function drive(n: number): number {
  return walk({ at: 0, sum: 0 }, n);
}
console.log("SAID", [1, 4, 6, 9].map(n => drive(n) + ":" + deeds).join(" "), process.argv.length);
