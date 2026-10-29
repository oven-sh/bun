// One turn in many takes a long way, which looks at the list of the record behind the test of the kind. The other turns look at nothing.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (j === 17 && r.kind === 0) {
      let t = sum | 0;
      t = ((t ^ 5) * 3 + r.part[0]!) | 0;
      t = ((t ^ 6) * 3 + j) | 0;
      t = ((t ^ 7) * 3 + j) | 0;
      t = ((t ^ 8) * 3 + j) | 0;
      t = ((t ^ 9) * 3 + j) | 0;
      t = ((t ^ 10) * 3 + j) | 0;
      t = ((t ^ 11) * 3 + r.part[0]!) | 0;
      t = ((t ^ 12) * 3 + j) | 0;
      t = ((t ^ 13) * 3 + j) | 0;
      t = ((t ^ 14) * 3 + j) | 0;
      t = ((t ^ 15) * 3 + j) | 0;
      t = ((t ^ 16) * 3 + j) | 0;
      t = ((t ^ 17) * 3 + r.part[0]!) | 0;
      t = ((t ^ 18) * 3 + j) | 0;
      t = ((t ^ 19) * 3 + j) | 0;
      t = ((t ^ 20) * 3 + j) | 0;
      t = ((t ^ 21) * 3 + j) | 0;
      t = ((t ^ 22) * 3 + j) | 0;
      t = ((t ^ 23) * 3 + r.part[0]!) | 0;
      t = ((t ^ 24) * 3 + j) | 0;
      t = ((t ^ 25) * 3 + j) | 0;
      t = ((t ^ 26) * 3 + j) | 0;
      t = ((t ^ 27) * 3 + j) | 0;
      t = ((t ^ 28) * 3 + j) | 0;
      sum = mix(sum, t + r.part.length);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
