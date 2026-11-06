console.log("second starts");
const first = require("./first.mjs");
exports.read = name => {
  try {
    return first[name];
  } catch (error) {
    return error.constructor.name;
  }
};
exports.seen = first.hoisted() + ", " + exports.read("late");
console.log("second ends");
