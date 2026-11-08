// Reference: bun build --compile
// In sloppy code a function that is declared in a block is a variable of the function around it too. `bun <file>` loses that variable with the branch.
const cases = {
  inABlock: [function () { if (false) { function g() {} } return g === undefined; }],
  inAnElse: [function () { if (true) ; else { function g() {} } return g === undefined; }],
  deep: [function (a) { if (false) { while (a) { function g() {} } } return g === undefined; }, 1],
  besideAVar: [function () { if (false) { var v; function g() {} } return [v, g]; }],
  underALet: [function () { let g = 1; if (false) { function g() {} } return g; }],
  inStrictCode: [function () { "use strict"; if (false) { function neverDeclaredAbove() {} } return typeof neverDeclaredAbove; }],
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
