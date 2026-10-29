// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
class Settled extends Promise {
  then() {
    return 5;
  }
}
function handle(promise) {
  return promise.catch(() => {});
}
const changed = Promise.resolve(1);
changed.then = () => "own then";
report("subclass", () => [typeof handle(new Settled(() => {})), handle(new Settled(() => {}))]);
report("own then", () => handle(changed));
report("ordinary promise", () => [typeof handle(Promise.resolve(1)), handle(Promise.resolve(1)) instanceof Promise]);
