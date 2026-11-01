// A new list is filled by a loop that walks a set, with what a function gives back. The function is replaced by one that takes members out of the set and puts others in.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function work(source: Set<number>, first: Step, second: Step, at: number): number {
  let step = first;
  const copy: number[] = [];
  let turn = 0;
  for (const member of source) {
    if (turn++ === at) step = second;
    copy.push(step(member));
    if (turn > 20) break;
  }
  return copy.length * 100 + (copy[copy.length - 1] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const source = new Set([i, i + 1, i + 2, i + 3, i + 4, i + 5]);
  total = mix(
    total,
    work(
      source,
      x => x * 2,
      x => {
        source.delete(x + 1);
        if (x & 1) source.add(x + 100);
        return x * 3;
      },
      i % 8,
    ),
  );
}
console.log(total);
