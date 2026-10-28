// A function that ends in a call leaves the stack before its callee runs. Each row makes an error at the end of a chain of such functions, under a limit on the number of frames, and prints the names that the stack trace lists. Every row runs twice.
const namesIn = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line => /at (\S+)/.exec(line)?.[1])
    .filter(name => name && !name.includes("/") && !name.includes(":"))
    .join(" < ");
let calls = 0;

function endsInError() {
  calls++;
  return new Error("x");
}
function endsInCall() {
  calls++;
  return endsInError();
}
function endsInSecondCall(many, ...rest) {
  calls += rest.length;
  return endsInCall(many);
}
function keepsResult() {
  const error = endsInSecondCall(1, 2, 3);
  calls++;
  return error;
}
function endsInKeeper() {
  calls++;
  return keepsResult();
}
function keepsAgain() {
  const error = endsInKeeper();
  calls++;
  return error;
}
function endsInConversion(operand) {
  calls++;
  return "abc".indexOf(operand);
}
function keepsConversion(operand) {
  try {
    const index = endsInConversion(operand);
    return index;
  } catch (error) {
    return error;
  }
}
for (const limit of [0, 1, 2, 3, 4, 10]) {
  Error.stackTraceLimit = limit;
  for (let turn = 0; turn < 2; turn++) {
    console.log(limit, "error:", namesIn(keepsAgain().stack));
    console.log(limit, "conversion:", namesIn(keepsConversion(Symbol()).stack));
  }
}
console.log(calls);
