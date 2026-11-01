// `{ ...source, b: i }` in a hot loop, where the copy is only read. The spread's rare generic path must not make the common path allocate.
// COUNT: branches >= 1
// COUNT: cells <= 1000
const o = { a: 1, b: 2, c: 3 };
function turn(i) {
  const inner = { ...o, b: i & 7 };
  const outer = { ...inner, c: 9 };
  return outer.a + outer.b + outer.c;
}
let sum = 0;
for (let i = 0; i < 70000; i++) sum += turn(i);
console.log(sum);
