// Every catch on the way up from the end of the stack copies the properties of one function onto another. Each copy returns its target or throws a RangeError, and the call behind it still works.
function target() {}
function source() {}
let probes = 0;
let wrongResults = 0;
let otherErrors = 0;

function copyProperties() {
  try {
    const result = Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    if (result !== target) wrongResults++;
  } catch (error) {
    if (!(error instanceof RangeError)) otherErrors++;
  }
  try {
    if (Object.setPrototypeOf(target, Object.getPrototypeOf(source)) !== target) wrongResults++;
  } catch (error) {
    if (!(error instanceof RangeError)) otherErrors++;
  }
}

function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000) copyProperties();
    throw error;
  }
}

try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
console.log("wrong results:", wrongResults, "other errors:", otherErrors);
console.log(Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) === target);
