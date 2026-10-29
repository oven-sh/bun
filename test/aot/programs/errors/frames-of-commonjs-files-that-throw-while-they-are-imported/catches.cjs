const { fail } = require("./fail.cjs");
try {
  fail("caught");
} catch (error) {
  exports.frames = error.stack;
}
