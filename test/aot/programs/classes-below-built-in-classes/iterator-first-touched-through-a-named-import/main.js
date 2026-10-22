// A class below Iterator is defined in another file and first touched through a named import.
import { Late } from "./late.js";
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("an instance", () => {
  const one = new Late();
  return [typeof one.map, one instanceof Late, one instanceof Iterator, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Iterator].join(" ");
});
