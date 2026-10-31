// `sum += row.amount || 0` over objects out of JSON.parse: the member is a fraction, an integer, zero, minus zero, missing, null, a text, a boolean, a list or an object.
// Whatever it is, the sum is what plain Bun makes of it: in a function, in a method, in a function held by a field and at the top level.
// Each way of using the member has a name of its own: what one function does with a name says something about that name everywhere.
let rows = JSON.parse("[]");
function total() {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) sum += rows[i].amount || 0;
  return sum;
}
function largest() {
  let most = -1;
  for (let i = 0; i < rows.length; i++) if ((rows[i].size || 1) > most) most = rows[i].size || 1;
  return most;
}
function scaled(factor) {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const price = rows[i].price;
    if (price) sum += price * factor;
  }
  return sum;
}
function lessEach() {
  let left = 1000;
  for (let i = 0; i < rows.length; i++) left -= rows[i].weight || 0.5;
  return left;
}
class Ledger {
  total() {
    let sum = 0;
    for (let i = 0; i < rows.length; i++) sum += rows[i].amount || 0;
    return sum;
  }
  doubled = () => {
    let sum = 0;
    for (let i = 0; i < rows.length; i++) sum += (rows[i].amount || 0) + (rows[i].amount || 0);
    return sum;
  };
}
const ledger = new Ledger();
function textOf(amounts, count) {
  let text = "[";
  for (let i = 0; i < count; i++) {
    const amount = amounts[i % amounts.length];
    text += (i ? "," : "") + (amount === undefined ? `{"id":${i}}` : `{"id":${i},"amount":${amount},"size":${amount},"price":${amount},"weight":${amount}}`);
  }
  return text + "]";
}
const kinds = {
  fractions: ["1.5", "2.25", "0.125"],
  integers: ["1", "2", "3"],
  mixed: ["1", "2.5", "0", "-0", "1e300", "-7", "0.0", "-1e-320"],
  missing: ["1.5", undefined, "2.5", undefined],
  nulls: ["1.5", "null", "2"],
  texts: ["1.5", '"2"', '""', '"x"'],
  booleans: ["true", "false", "3"],
  lists: ["[]", "[4]", "1"],
  objects: ["{}", "2"],
  onlyMissing: [undefined],
  onlyTexts: ['"a"', '"b"'],
};
for (const name in kinds) {
  rows = JSON.parse(textOf(kinds[name], 24));
  let answers;
  for (let turn = 0; turn < 300; turn++) {
    let sum = 0;
    for (let i = 0; i < rows.length; i++) sum += rows[i].amount || 0;
    answers = [total(), largest(), scaled(2), lessEach(), ledger.total(), ledger.doubled(), sum];
  }
  console.log(name, answers.map(String).join(" | "));
}
