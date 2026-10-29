// A new list, a new map and a new set are filled in loops up to the length of a source. One turn of each loop cuts the source, or pushes to it.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(source: number[], at: number, grows: boolean): number {
  const copy: number[] = [];
  const index = new Map<number, number>();
  const seen = new Set<number>();
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.push(j, j + 100, j + 200) : source.pop();
    copy.push(source[j]! * 2);
  }
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.push(j + 300) : source.shift();
    index.set(source[j]!, j);
  }
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.unshift(j + 400) : (source.length = j);
    seen.add(source[j]!);
  }
  return copy.length * 10000 + index.size * 100 + seen.size;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, i + 1, i + 2, i + 3, i + 4, i + 5], i % 8, (i & 8) === 0));
console.log(total);
