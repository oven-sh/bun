// The build has matched the receiver of performance.now(), so the compiled call enters the function that reads the clock and no function object stands in between.
// STATISTIC: NativeFunctionsCalledDirectly >= 1
function elapsed(from) {
  return performance.now() - from;
}
let least = Infinity;
for (let turn = 0; turn < 1000; turn++) least = Math.min(least, elapsed(0));
console.log(least > 0);
