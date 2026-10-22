// An ES module that defines a class below Error is imported under two names that differ in their query.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const first = (await import("./late.js?one")).default;
const second = (await import("./late.js?two")).default;
tell("the classes", () => [first === second, first.next(), second.next(), globalThis.evaluations].join(" "));
