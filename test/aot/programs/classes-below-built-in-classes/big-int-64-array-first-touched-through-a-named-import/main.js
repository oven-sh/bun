// A class below BigInt64Array is defined in another file and first touched through a named import.
import { Late } from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("an instance", () => {
  const one = new Late(1);
  return [one.length, one instanceof Late, one instanceof BigInt64Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === BigInt64Array].join(" ");
});
