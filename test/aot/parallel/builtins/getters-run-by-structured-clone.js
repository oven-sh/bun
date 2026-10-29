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
let count = 0;
function countAcross(create) {
  const source = create();
  const before = count;
  const copy = structuredClone(source);
  return [count - before, copy];
}
report("a literal with a getter", () =>
  countAcross(() => ({
    a: 1,
    get g() {
      return ++count;
    },
  })),
);
report("an array of literals with getters", () =>
  countAcross(() => [
    {
      get g() {
        return ++count;
      },
    },
    {
      get g() {
        return ++count;
      },
    },
  ]),
);
report("a getter one level down", () =>
  countAcross(() => ({
    inner: {
      get g() {
        return ++count;
      },
    },
  })),
);
report("plain data", () => countAcross(() => ({ a: [1, "b", null], c: { d: true } })));
