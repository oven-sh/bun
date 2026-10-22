// A class below Boolean is defined in another file and first touched through import().
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const { Late } = await import("./late.js");
tell("an instance", () => {
  const one = new Late(true);
  return [one.valueOf(), one instanceof Late, one instanceof Boolean, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Boolean].join(" ");
});
