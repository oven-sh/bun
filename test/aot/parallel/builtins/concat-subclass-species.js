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
class SpeciesObject extends Array {
  static get [Symbol.species]() {
    return Object;
  }
}
class SpeciesUndefined extends Array {
  static get [Symbol.species]() {
    return undefined;
  }
}
class SpeciesInherited extends Array {}
function concat(list, more) {
  const result = list.concat(more);
  return [Array.isArray(result), result.constructor.name, Object.keys(result).join(), result.length, result[2]];
}
report("species Object", () => concat(new SpeciesObject(1, 2), [3]));
report("species undefined", () => concat(new SpeciesUndefined(1, 2), [3]));
report("inherited species", () => concat(new SpeciesInherited(1, 2), [3]));
report("ordinary array", () => concat([1, 2], [3]));
