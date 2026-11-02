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
function fill(length, stopAt) {
  return Array.from({ length }, (_, i) => {
    if (i === 4) Bun.gc(true);
    if (i === stopAt) throw new RangeError("stop");
    return i * 2;
  });
}
report("2 ** 27", () => fill(2 ** 27, 8));
report("2 ** 27 + 1", () => fill(2 ** 27 + 1, 8));
report("6", () => fill(6, 9));
report("0", () => fill(0, 0));
