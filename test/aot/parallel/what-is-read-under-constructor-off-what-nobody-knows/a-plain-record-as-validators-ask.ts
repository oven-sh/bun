// The answer of the read is only looked at: no built-in under the name leaves, and the library behind them stays out of the image.
// STATISTIC: ImageFunctionsEmitted <= 10
function isRecord(value: any): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPlainRecord(given: any): boolean {
  if (isRecord(given) === false) return false;
  const kept = given.constructor;
  if (kept === undefined) return true;
  if (typeof kept !== "function") return true;
  const above = kept.prototype;
  if (isRecord(above) === false) return false;
  if (Object.prototype.hasOwnProperty.call(above, "isPrototypeOf") === false) return false;
  return true;
}
console.log(String(isPlainRecord(JSON.parse("{}"))), String(isPlainRecord(JSON.parse("[]"))), String(isPlainRecord(JSON.parse('{"constructor":5}'))), String(isPlainRecord(JSON.parse("null"))));
