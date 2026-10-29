// A function without types is handed the member of a record that only some records have, and asks in every turn for its truth before it reads an element.
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
  for (let j = 0; j < n; j++) {
    if (part) sum = mix(sum, part[j % 3] + part.length);
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, walk(make(i).part, 24));
console.log(total);
