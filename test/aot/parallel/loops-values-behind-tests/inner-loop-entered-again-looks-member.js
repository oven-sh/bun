// The record is made in front of two loops. The inner loop, which is entered once a turn of the outer one, looks at the list, and has no turns for a record without one.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i, rows) {
  const r = make(i);
  const part = r.part;
  const cells = r.kind === 0 ? 3 : 0;
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    sum += row;
    for (let cell = 0; cell < cells; cell++) sum = mix(sum, part[cell] + part.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 8));
console.log(total);
