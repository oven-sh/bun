// A CommonJS file that throws while it runs has not run: the next require() of it runs it again from the top, with a new `module` and new `exports`.
// Three files: one that throws every time, one that returns at its third run, and one that is asked for under a name made at run time.
// Entry points: ./named.cjs
function ask(load) {
  const seen = [], errors = [];
  for (let turn = 0; turn < 4; turn++) {
    try {
      seen.push(Object.keys(load()).join("+"));
    } catch (error) {
      errors.push(error);
      seen.push(error.message);
    }
  }
  return JSON.stringify(seen) + " the same error: " + (errors[0] === errors[1]);
}
console.log("always", ask(() => require("./always.cjs")), "runs", globalThis.always);
console.log("third", ask(() => require("./third.cjs")), "runs", globalThis.third);
console.log("named", ask(() => require(["./na", "med.cjs"].join(""))), "runs", globalThis.named);
