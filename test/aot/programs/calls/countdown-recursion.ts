// A recursive function that counts down and then uses a small array.
function probe(n: number): number {
  if (n > 0) return probe(n - 1)
  const xs = [1, 2, 3]
  const d = xs.map(x => x * 2)
  return d[2]!
}
console.log(probe(1))
