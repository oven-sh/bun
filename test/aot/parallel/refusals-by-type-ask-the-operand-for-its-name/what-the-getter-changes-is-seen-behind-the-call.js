// The message of a refusal asks the class of the operand for its name. The getter is code of the program, and what it changes is read anew behind the call.
let asked = 0;
class Made {
  static get name() {
    asked++;
    return "Made";
  }
}
function refusedOnce(operand) {
  const before = asked;
  try {
    process.chdir(operand);
  } catch {}
  return asked - before;
}
let sum = 0;
for (let turn = 0; turn < 3; turn++) sum += refusedOnce(new Made());
console.log(sum, asked);
