// A class below String is defined in another file and first touched through the namespace of that file, under a key that is put together at run time.
import * as all from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const Late = all[["La", "te"].join("")];
tell("an instance", () => {
  const one = new Late("text");
  return [one.length + one.valueOf(), one instanceof Late, one instanceof String, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === String].join(" ");
});
