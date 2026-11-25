// Flags: --define=BELOW=-3 --define=LIST=[1,2] --define=RECORD={"x":1}
// Reference: bun build --compile
// The value of --define stands in place of the name in what `toString()` gives, also where the name is the first thing in a line.
const five = () => 5;
const cases = {
  aNumberBelowZero: [function (a) { let b = a
    BELOW
    return b; }, 10],
  aList: [function (a) { let b = a
    LIST.length
    return typeof b; }, [0, 0, [5]]],
  aRecord: [function (a) { let b = a
    RECORD.x
    return typeof b; }, five],
  behindAnOperator: [function (a) { let b = a
    true && LIST.length
    return typeof b; }, [0, 0, [5]]],
};
const show = (run) => {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return error.constructor.name;
  }
};
for (const [name, [f, ...given]] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + show(() => f(...given)) + " | " + show(() => again(...given)));
}
