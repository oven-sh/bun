// A class below RegExp is defined in another file and first touched through require of a CommonJS file.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const { Late } = require("./late.cjs");
tell("an instance", () => {
  const one = new Late("a", "g");
  return [one.test("a") + one.flags, one instanceof Late, one instanceof RegExp, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RegExp].join(" ");
});
