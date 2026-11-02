// A function without types asks in every turn whether the record has a list, by the truth of the member, and reads the list behind that.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i, n) {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.part) sum = mix(sum, r.part[j % 3] + r.part.length);
    else if (r.name) sum = mix(sum, r.name.length);
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
