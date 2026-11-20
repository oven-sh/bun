const seen: unknown[] = [];
function other(value: unknown) {
  if (typeof value === "string") return "s";
  seen.push(value);
  return "o";
}
function notNumber(value: unknown) {
  if (typeof value === "number") return "n";
  seen.push(value);
  return "o";
}
function notBoolean(value: unknown) {
  if (typeof value === "boolean") return "b";
  seen.push(value);
  return "o";
}
const values: unknown[] = ["a", "", 1, 1.5, NaN, true, false, null, undefined, {}, [], () => 1, Symbol.for("s"), 10n, new String("boxed"), new Number(3), new Boolean(false)];
console.log(values.map(other).join(""), values.map(notNumber).join(""), values.map(notBoolean).join(""));
console.log(seen.map(value => (typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? "bigint" : typeof value + ":" + String(value))).join("|"));
