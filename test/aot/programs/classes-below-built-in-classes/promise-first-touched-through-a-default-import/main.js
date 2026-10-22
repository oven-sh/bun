// A class below Promise is defined in another file and first touched through the default import.
import Late from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("an instance", () => {
  const one = new Late(resolve => resolve(5));
  return [typeof one.then, one instanceof Late, one instanceof Promise, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Promise].join(" ");
});
