// STATISTIC: NumbersReadOffListsKnownAgain >= 1
const rounds = Number(process.argv[2] ?? 3);
function fractions(length, step) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(i * step + 0.5);
  return list;
}
function squares(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i] * list[i];
  return sum;
}
const numbers = fractions(24, 1.25);
const said = [];
for (let round = 0; round < rounds; round++) said.push(squares(numbers));
console.log(said.join(" "));
