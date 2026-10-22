// A file that defines a class below Array is imported and required.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const first = (await import("./late.cjs")).default;
const second = require("./late.cjs");
tell("the classes", () => [first === second, first.next(), second.next(), globalThis.evaluations].join(" "));
