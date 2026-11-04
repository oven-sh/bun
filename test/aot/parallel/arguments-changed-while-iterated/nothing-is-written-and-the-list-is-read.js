function total() {
  let sum = 0;
  for (const value of arguments) sum += value;
  return sum;
}
function texts() {
  let text = "";
  for (const value of arguments) text += value + ";";
  return text;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += total(turn, 1, 2, 3);
console.log(sum, total(), total(5), texts("a", "b", "c"), texts());
