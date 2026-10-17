// makes an Error three calls deep with Error.stackTraceLimit = 2 and never reads its stack
Reflect.set(Error, "stackTraceLimit", 2);
function innermost(): Error {
  return new Error();
}
function middle(): Error {
  return innermost();
}
function outer(): Error {
  return middle();
}
const callers = [outer, outer];
const operations = 40;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (callers[i & 1]!().message === "") total++;
  }
}

console.log(total);
