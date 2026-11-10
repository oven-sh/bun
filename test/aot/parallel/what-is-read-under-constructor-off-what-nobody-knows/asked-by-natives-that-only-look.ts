// The answer of the read is only looked at: no built-in under the name leaves, and the library behind them stays out of the image.
// STATISTIC: ImageFunctionsEmitted <= 30
function ask(given: any): string {
  const kept = given.constructor;
  const above = kept.prototype;
  return [Array.isArray(kept), Array.isArray(above), Object.is(kept, above), Object.prototype.hasOwnProperty.call(kept, "from"), Object.prototype.hasOwnProperty.call(above, "push")].map(String).join(" ");
}
console.log(ask(JSON.parse("[]")), ask(JSON.parse("{}")));
