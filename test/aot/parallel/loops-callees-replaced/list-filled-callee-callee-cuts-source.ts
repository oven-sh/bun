// A new list is filled in a loop up to the length of another list, with what a function gives back. The function is replaced by one that cuts the other list.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function work(source: number[], first: Step, second: Step, at: number): number {
  let step = first;
  const copy: number[] = [];
  for (let j = 0; j < source.length; j++) {
    if (j === at) step = second;
    copy.push(step(source[j]!));
  }
  return copy.length * 100 + (copy[copy.length - 1] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const source = [i, i + 1, i + 2, i + 3, i + 4, i + 5];
  total = mix(
    total,
    work(
      source,
      x => x * 2,
      x => {
        source.length = 4;
        return x * 3;
      },
      i % 8,
    ),
  );
}
console.log(total);
