// A class below Set is defined in another file and first touched through the default import.
import Late from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("an instance", () => {
  const one = new Late([1, 2]);
  return [one.size, one instanceof Late, one instanceof Set, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Set].join(" ");
});
