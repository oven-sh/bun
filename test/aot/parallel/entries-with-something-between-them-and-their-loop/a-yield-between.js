function* tally(stock) {
  const rows = Object.entries(stock);
  let total = yield "asked";
  for (const [name, count] of rows) total = total + count + name.length;
  return total;
}
const steps = tally({ apples: 3, pears: 4 });
const one = steps.next();
const junk = [];
for (let i = 0; i < 1000; i++) junk.push({ i });
console.log(one.value, steps.next(5).value, junk.length);
