// A class below DisposableStack is defined in another file and first touched through import().
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const { Late } = await import("./late.js");
tell("an instance", () => {
  const one = new Late();
  return [one.disposed, one instanceof Late, one instanceof DisposableStack, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DisposableStack].join(" ");
});
