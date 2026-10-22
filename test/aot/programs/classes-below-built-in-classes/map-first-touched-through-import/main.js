// A class below Map is defined in another file and first touched through import().
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const { Late } = await import("./late.js");
tell("an instance", () => {
  const one = new Late([[1, 2]]);
  return [one.size + one.get(1), one instanceof Late, one instanceof Map, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Map].join(" ");
});
