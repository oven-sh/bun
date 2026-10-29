// A function without parameters that a program adds to Map.prototype throws: what the first and the second require of node:stream do.
// Plain Bun runs the body of the module again at each require. An executable runs it once and keeps what it threw, as for a file of the program.
Map.prototype.toJSON = function () {
  throw new Error("thrown by toJSON");
};
for (const round of [1, 2]) {
  try {
    console.log(round, typeof require("node:stream").Readable);
  } catch (error) {
    console.log(round, error.message);
  }
}
delete Map.prototype.toJSON;
try {
  console.log(typeof require("node:stream").Readable);
} catch (error) {
  console.log(error.message);
}
/* Output:
1 thrown by toJSON
2 thrown by toJSON
thrown by toJSON
*/
