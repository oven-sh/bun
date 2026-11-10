// RUN: link
// CHECK: fields=[{key="amount" declared={type=undefined|number flags=[IsExpected]}}, {key="id" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]

// The first literal has every name of the three, so the type that the widening gives each of them is the type of an object of the program: its layout says what the fields are expected to hold.
const rows = [{ id: 1, amount: 2 }, { id: 3 }, { id: 4, amount: 5 }];
function total(rows) {
  let sum = 0;
  for (const amount of rows.map(row => row.amount)) sum += amount === undefined ? 100 : amount;
  return sum;
}
console.log(total(rows));
