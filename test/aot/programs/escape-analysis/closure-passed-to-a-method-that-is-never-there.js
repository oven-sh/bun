// The receiver is a number, so the method that takes the closure is never found and the call throws. Nothing keeps the closure, whether the call stands alone, in a loop, or gets more arguments.
function entered(list) { return list.map(value => value); }
function withCapture(list, step) { return list.map(value => value + step, step); }
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(attempt(() => entered(5)));
console.log(attempt(() => withCapture(6, 1)));
for (let round = 0; round < 3; round++)
  console.log(round, attempt(() => entered(round)));
console.log(attempt(() => [1, 2].map(value => value * 2)));
