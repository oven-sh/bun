// A store through a defined name whose `--define` value names a `let` that is declared further down throws a ReferenceError where the store runs: behind the value of the store, and ahead of it where a closure holds the `let`.
// Flags: --define NAME=target
const seen = [];
function behindTheValue() {
  try {
    NAME = (seen.push("the value"), 1);
  } catch (error) {
    seen.push(error.constructor.name);
  }
  let target = 0;
  return target;
}
function aheadOfTheValue() {
  try {
    NAME = (seen.push("no value"), 1);
  } catch (error) {
    seen.push(error.constructor.name);
  }
  let target = 0;
  return () => target;
}
function ofAnUpdate() {
  try {
    NAME++;
  } catch (error) {
    seen.push(error.constructor.name);
  }
  let target = 0;
  return target;
}
function ofAPattern() {
  try {
    [NAME] = [1];
  } catch (error) {
    seen.push(error.constructor.name);
  }
  let target = 0;
  return target;
}
console.log(behindTheValue(), aheadOfTheValue()(), ofAnUpdate(), ofAPattern(), seen.join(" "));
