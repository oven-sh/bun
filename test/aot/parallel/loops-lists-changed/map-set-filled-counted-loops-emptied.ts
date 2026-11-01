// A map and a set that the function is given are filled by counted loops. One turn empties them, or takes out what the turns before it put in.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function fill(index: Map<number, number>, members: Set<number>, at: number, n: number): number {
  for (let j = 0; j < n; j++) {
    if (j === at) at & 1 ? index.clear() : index.delete(j - 1);
    index.set(j, j * 2);
  }
  for (let j = 0; j < n; j++) {
    if (j === at) at & 1 ? members.clear() : members.delete((j - 1) * 3);
    members.add(j * 3);
  }
  return index.size * 100 + members.size;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, fill(new Map([[i + 1000, 1]]), new Set([i + 1000]), i % 50, 40));
console.log(total);
