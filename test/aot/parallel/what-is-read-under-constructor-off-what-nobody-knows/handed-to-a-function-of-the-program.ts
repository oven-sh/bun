// The answer of the read is only looked at: no built-in under the name leaves, and the library behind them stays out of the image.
// STATISTIC: ImageFunctionsEmitted <= 10
function kindOf(value: any): string {
  return typeof value;
}
function ask(given: any): string {
  return kindOf(given.constructor) + " " + kindOf(given.constructor.prototype);
}
console.log(ask(JSON.parse("{}")), ask(JSON.parse("3")));
