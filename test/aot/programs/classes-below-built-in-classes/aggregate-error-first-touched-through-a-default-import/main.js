// A class below AggregateError is defined in another file and first touched through the default import.
import Late from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("an instance", () => {
  const one = new Late([new Error("a")], "m");
  return [one.errors.length + one.message, one instanceof Late, one instanceof AggregateError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === AggregateError].join(" ");
});
