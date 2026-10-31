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
const held = { x: 1 };
function create() {
  return Object.create(null, {
    a: {
      get value() {
        return held;
      },
      enumerable: true,
    },
  });
}
report("first", () => {
  const made = create();
  made.a.x++;
  return [made.a === held, held.x, Object.keys(made)];
});
report("second", () => {
  const made = create();
  made.a.x++;
  return [made.a === held, held.x];
});
