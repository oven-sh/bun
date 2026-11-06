// A function without parameters that a program adds to Map.prototype throws: what the first and the second require of node:stream do.
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
