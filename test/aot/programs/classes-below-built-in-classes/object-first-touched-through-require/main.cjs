// A class below Object is defined in another file and first touched through require of a CommonJS file.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const { Late } = require("./late.cjs");
tell("an instance", () => {
  const one = new Late();
  return [Object.keys(one).length, one instanceof Late, one instanceof Object, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Object].join(" ");
});
