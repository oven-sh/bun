// A class below Uint8Array is defined in another file and first touched as the exports object of a CommonJS file.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const Late = require("./late.cjs");
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof Uint8Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Uint8Array].join(" ");
});
