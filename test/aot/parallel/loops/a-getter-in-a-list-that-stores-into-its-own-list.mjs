// Flags: --aot-harden=proof-checks
// A list has a getter that stores into the list itself, and another list grows while it is read. A read that is remembered is made again to be checked: the build stopped.
function ignore(list, other) {}
function multiply(list, factors) {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    sum += list[index] * factors[index];
    if (index >= 3) factors.push(list[index]);
  }
  return sum;
}
{
  let list = JSON.parse("[6,74,14,71,52]"),
    factors = JSON.parse("[88,55,26,44,62]");
  console.log(multiply(list, factors));
  ignore(list, factors);
}
{
  let list = JSON.parse("[null,-1,0,23,0]").map(value => value * 2),
    factors = [];
  console.log(multiply(list, factors));
  ignore(list, factors);
}
{
  let list = [0, 4, 60, -3, 14];
  Object.defineProperty(list, 3, {
    get() {
      list[2] = 0.5;
      return 1;
    },
    configurable: true,
  });
  ignore(list, [68]);
}
