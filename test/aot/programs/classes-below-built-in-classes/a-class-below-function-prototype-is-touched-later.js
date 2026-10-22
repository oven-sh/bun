// `class Late extends Function.prototype`: whether the definition throws, and where, is as in plain Bun, whenever the class would be made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
console.log("above the definition");
let Late;
tell("the definition", () => {
  Late = class extends Function.prototype {};
  return "done";
});
console.log("below the definition");
tell("the touch", () => typeof Late);
tell("an instance", () => typeof new Late());
