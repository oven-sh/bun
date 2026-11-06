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
class C {
  constructor(x) {
    this.made = new.target.name + x;
  }
}
class D {
  only() {
    return "only on D: " + this.made;
  }
}
function construct(target, newTarget) {
  return Reflect.construct(target, [1], newTarget);
}
report("other new.target", () => [construct(C, D).only(), construct(C, D) instanceof D, construct(C, D) instanceof C]);
report("same new.target", () => [construct(C, C).made, construct(C, C) instanceof C]);
report("no new.target", () => Reflect.construct(C, [2]).made);
