// A function without types walks what it is given. For a record without a list it is given the member that is not there, and the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function walk(part, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, part[j % 3] + part.length);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const r = make(i);
  total = mix(total, walk(r.part, r.kind === 0 ? 24 : 0));
}
console.log(total);
