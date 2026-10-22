// A body throws with no handler on the way, in front of a `const l = require(..)`. A closure that it handed out earlier is called from the handler of uncaught exceptions: the constant is still in its dead zone.
process.on("uncaughtException", () => {
  try {
    console.log(globalThis.peek());
  } catch (error) {
    console.log(error.constructor.name);
  }
});
require("./mid.cjs");
