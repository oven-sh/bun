// Two sites of `[]`, 1,000 arrays each: those of the first stay empty, those of the second take four values at once.
// A site learns from the arrays it has made how much room the next one gets. object-census.test.ts runs it without collections and counts the arrays by length and room. The output is that of plain Bun.
const kept = [];
function staysEmpty() {
  return [];
}
function takesFour(i) {
  const list = [];
  list.push(i);
  list.push(i + 1);
  list.push(i + 2);
  list.push(i + 3);
  return list;
}
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const empty = staysEmpty();
  const four = takesFour(i);
  kept.push(empty, four);
  sum += empty.length + four.length + four[3];
}
console.log(sum, kept.length);
