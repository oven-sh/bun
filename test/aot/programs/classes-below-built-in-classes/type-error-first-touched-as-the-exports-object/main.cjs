// A class below TypeError is defined in another file and first touched as the exports object of a CommonJS file.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const Late = require("./late.cjs");
tell("an instance", () => {
  const one = new Late("m");
  return [one.message + one.name, one instanceof Late, one instanceof TypeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === TypeError].join(" ");
});
