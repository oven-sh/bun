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
const item = { n: 1 };
function bump(value) {
  value.n++;
  return value === item;
}
report("map", () => [[...[item].values().map(bump)], item.n]);
report("filter", () => [[...[item].values().filter(bump)].length, item.n]);
report("flatMap", () => [[...[item].values().flatMap(value => [bump(value), value.n])], item.n]);
report("drop and take", () => [[...[1, 2, 3].values().drop(1)], [...[1, 2, 3].values().take(2)]]);
