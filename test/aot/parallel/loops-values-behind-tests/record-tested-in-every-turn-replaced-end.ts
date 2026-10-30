// The variable of a loop holds a record that every turn tests and then replaces. The loop ends at the first record without a list.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number): number {
  let sum = 0;
  let r = make(i);
  for (let j = 0; ; j++) {
    if (r.kind !== 0) break;
    sum = mix(sum, r.part[j % 3]! + r.part.length);
    r = make(i + j + 1);
  }
  return mix(sum, r.kind === 1 ? r.name.length : -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
