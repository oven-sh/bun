// The frames of an error thrown by the callback of a typed array's traversal, and of one that the traversal throws itself.
const frames = error =>
  error.stack
    .split("\n")
    .slice(0, 5)
    .map(line => line.replace(/(\(|at )[^ (]*[\\/]/, "$1").trim())
    .join(" | ");
const numbers = new Int32Array([1, 2, 3]);
for (const method of ["forEach", "every", "some", "find", "findIndex", "findLast", "findLastIndex"]) {
  try {
    numbers[method](function callee(element) {
      throw new Error("from " + method + " at " + element);
    });
  } catch (error) {
    console.log(frames(error));
  }
  try {
    numbers[method](1);
  } catch (error) {
    console.log(frames(error));
  }
  try {
    Int32Array.prototype[method].call({}, () => 1);
  } catch (error) {
    console.log(frames(error));
  }
}
