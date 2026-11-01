// createRequire() refuses what is no path and no file URL, and its message prints the operand: a field that nothing else reads is still there.
const { createRequire } = require("module");
class Point {
  x = 1;
  get z() {
    return 3;
  }
}
function refused(operand) {
  try {
    createRequire(operand);
    return "taken";
  } catch (error) {
    return error.code + ": " + error.message;
  }
}
console.log(refused(new Point()));
console.log(refused({}));
console.log(refused({ a: 1, b: "x" }));
console.log(refused({ a: 1, b: { c: [1, 2] } }));
console.log(refused([1, { a: 2 }]));
console.log(refused(5));
console.log(refused("../"));
console.log(typeof createRequire(__filename));
