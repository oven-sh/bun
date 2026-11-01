// Says whether a function is still on the stack while the function runs whose result it keeps in a variable and returns, where statements that never run stand behind the `return`.
let found = [];
function last(x) {
  found = String(new Error("here").stack)
    .split("\n")
    .map(line => /at (\w+) \(/.exec(line)?.[1]);
  return x + 1;
}
function returnedAgain(x) {
  const r = last(x);
  return r;
  return r;
}
function printedBehind(x) {
  const r = last(x);
  return r;
  console.log(r);
}
function returnedAgainInABlock(x) {
  const r = last(x);
  return r;
  {
    return r;
  }
}
function capturedBehind(x) {
  const r = last(x);
  return r;
  function reads() {
    return r;
  }
}
function returnedOnce(x) {
  const r = last(x);
  return r;
}
for (const callee of [returnedAgain, printedBehind, returnedAgainInABlock, capturedBehind, returnedOnce]) {
  const result = callee(1);
  console.log(callee.name, result, found.includes(callee.name) ? "is on the stack" : "is not on the stack");
}
