// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
function same(a, b) {
  return a === b;
}
const view = Uint8Array.of(1, 2);
report("trimLeft", () => ["".trimLeft === "".trimStart, same("".trimLeft, "".trimStart)]);
report("trimRight", () => ["".trimRight === "".trimEnd, same("".trimRight, "".trimEnd)]);
report("trimLeft of the prototype", () => String.prototype.trimLeft === String.prototype.trimStart);
report("trimRight of the prototype", () => String.prototype.trimRight === String.prototype.trimEnd);
report("two trim functions", () => ["".trimLeft === "".trimEnd, same("".trimStart, "".trim)]);
report("trim called", () => [" a ".trimLeft(), " a ".trimStart(), " a ".trimRight(), " a ".trimEnd()]);
report("values", () => Uint8Array.prototype.values === Uint8Array.prototype[Symbol.iterator]);
report("values of an instance", () => view.values === view[Symbol.iterator]);
report("values, untyped", () => same(view.values, view[Symbol.iterator]));
report("toString", () => Uint8Array.prototype.toString === Array.prototype.toString);
report("toString of an instance", () => [view.toString === [].toString, same(view.toString, [].toString)]);
report("values of another class", () => Uint8Array.prototype.values === Array.prototype.values);
report("keys and values", () => [view.keys === view.values, same(view.keys, view.values)]);
report("typed array called", () => [[...view.values()], [...view[Symbol.iterator]()], view.toString()]);
